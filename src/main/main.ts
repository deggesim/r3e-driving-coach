/**
 * Electron main process entry point.
 *
 * Responsibilities:
 * 1. Create BrowserWindow (1200×800, no frame, contextIsolation, no nodeIntegration)
 * 2. Instantiate: R3EReader → LapRecorder → AdaptiveBaseline → ZoneTracker → RuleEngine + AlertDispatcher → CoachEngine
 * 3. IPC channels (push and request/response)
 * 4. Session management in SQLite
 * 5. App lifecycle
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { R3EReader } from './r3e/r3e-reader';
import { LapRecorder } from './r3e/lap-recorder';
import { ZoneTracker } from './r3e/zone-tracker';
import { AdaptiveBaseline } from './coach/adaptive-baseline';
import { AlertDispatcher, RuleEngine } from './coach/rule-engine';
import { CoachEngine } from './coach/coach-engine';
import { getDb, seedCornerNames, getCornerName } from './db/db';
import type { LapRecord, LapAnalysis, R3EStatus, R3EFrame, Alert } from '../shared/types';
import cornerNamesData from '../shared/corner-names.json';

const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let reader: R3EReader | null = null;

// ──────────────────────────────────────────────
// Window creation
// ──────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (IS_DEV) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ──────────────────────────────────────────────
// Push helpers
// ──────────────────────────────────────────────

function pushToRenderer(channel: string, data: unknown): void {
  mainWindow?.webContents.send(channel, data);
}

// ──────────────────────────────────────────────
// Setup pipeline
// ──────────────────────────────────────────────

function setupPipeline(): void {
  const userDataPath = app.getPath('userData');
  const db = getDb(userDataPath);

  // Seed corner names on first run
  seedCornerNames(db, cornerNamesData as Record<string, Array<{ distMin: number; distMax: number; name: string }>>);

  // Corner name lookup helper
  let currentTrack = '';
  let currentLayout = '';
  const lookupCorner = (dist: number): string | null =>
    getCornerName(db, currentTrack, currentLayout, dist);

  // Build a zone→corner name map for prompt builder
  const buildCornerMap = (): Map<number, string> => {
    const map = new Map<number, string>();
    for (let d = 0; d < 6000; d += 50) {
      const name = lookupCorner(d);
      if (name) map.set(Math.floor(d / 50), name);
    }
    return map;
  };

  // Components
  const dispatcher = new AlertDispatcher();
  const zoneTracker = new ZoneTracker();

  // Placeholder baseline (will be recreated when car/track is known)
  let baseline = new AdaptiveBaseline('unknown', 'unknown', db);
  let ruleEngine = new RuleEngine(dispatcher, baseline, lookupCorner);

  const recorder = new LapRecorder(baseline.isReady);

  const coachEngine = new CoachEngine({
    db,
    onAnalysis: (analysis: LapAnalysis) => {
      pushToRenderer('r3e:analysis', analysis);
    },
  });

  // Alert dispatcher → renderer
  dispatcher.on('alert', (alert: Alert) => {
    pushToRenderer('r3e:alert', alert);
  });

  // Session tracking
  let currentSessionId: number | null = null;

  // ─── Reader
  reader = new R3EReader();

  reader.on('connected', () => {
    pushStatus(recorder);
  });

  reader.on('disconnected', () => {
    pushStatus(recorder);
  });

  reader.on('frame', (frame: R3EFrame) => {
    // Update current track info for corner lookups
    if (frame.trackName) currentTrack = frame.trackName;
    if (frame.layoutName) currentLayout = frame.layoutName;

    // Update zone tracker
    zoneTracker.update(frame);

    // Process P1/P2 rules
    ruleEngine.processFrame(frame);

    // Push frame to renderer (throttled — renderer handles its own rate)
    pushToRenderer('r3e:frame', frame);
  });

  reader.on('lapComplete', async (lapData) => {
    // Re-create baseline if car/track changed
    if (lapData.car !== baseline.car || lapData.track !== baseline.track) {
      baseline = new AdaptiveBaseline(lapData.car, lapData.track, db);
      ruleEngine = new RuleEngine(dispatcher, baseline, lookupCorner);
      coachEngine.updateCornerNames(buildCornerMap());
    }

    // Reset zone tracker for new lap
    zoneTracker.reset();
    ruleEngine.resetLap();

    // Ensure session exists
    if (!currentSessionId) {
      currentSessionId = createSession(db, lapData.car, lapData.track, lapData.layout);
    }
    saveLap(db, currentSessionId, lapData as LapRecord);
  });

  // ─── LapRecorder
  recorder.attach(reader);

  recorder.on('lapRecorded', async (lap: LapRecord, { calibrating }: { calibrating: boolean }) => {
    pushToRenderer('r3e:lapComplete', lap);
    pushStatus(recorder);

    // Ingest into baseline
    const deviations = baseline.ingestLap(lap.zones, lap.lapNumber, calibrating);

    // Process P3 deviations
    if (deviations && deviations.length > 0) {
      ruleEngine.processLapDeviations(deviations);
    }

    // Post-lap Claude analysis (if not calibrating and API key is available)
    if (!calibrating) {
      const apiKey = await ipcMain.emit('config:get', null, 'anthropicApiKey') as unknown as string;
      if (apiKey) coachEngine.updateApiKey(apiKey);
      coachEngine.analyzeLap(lap, deviations).catch(console.error);
    }
  });

  recorder.on('calibrationComplete', () => {
    pushStatus(recorder);
  });

  // ─── Config IPC (API key)
  ipcMain.handle('config:get', (_event, key: string) => {
    return db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string } | undefined;
  });

  ipcMain.handle('config:set', (_event, key: string, value: unknown) => {
    db.prepare(
      'INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)',
    ).run(key, String(value));
  });

  // ─── DB IPC
  ipcMain.handle('db:getLaps', (_event, { car, track }: { car: string; track: string }) => {
    return db.prepare(`
      SELECT l.* FROM laps l
      JOIN sessions s ON l.session_id = s.id
      WHERE s.car = ? AND s.track = ?
      ORDER BY l.recorded_at DESC
      LIMIT 200
    `).all(car, track);
  });

  ipcMain.handle('db:getSession', (_event, id: number) => {
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  });

  // Start reader
  reader.start();

  pushStatus(recorder);
}

// ──────────────────────────────────────────────
// Status push
// ──────────────────────────────────────────────

function pushStatus(recorder: LapRecorder): void {
  const status: R3EStatus = {
    connected: reader !== null,
    calibrating: recorder.isCalibrating,
    lapsToCalibration: recorder.lapsToCalibration,
    car: null,
    track: null,
    layout: null,
  };
  pushToRenderer('r3e:status', status);
}

// ──────────────────────────────────────────────
// SQLite session/lap helpers
// ──────────────────────────────────────────────

import type BetterSqlite3 from 'better-sqlite3';

function createSession(
  db: BetterSqlite3.Database,
  car: string,
  track: string,
  layout: string,
): number {
  const result = db.prepare(`
    INSERT INTO sessions (car, track, layout, session_type, started_at)
    VALUES (?, ?, ?, 'practice', datetime('now'))
  `).run(car, track, layout);
  return result.lastInsertRowid as number;
}

function saveLap(db: BetterSqlite3.Database, sessionId: number, lap: LapRecord): void {
  db.prepare(`
    INSERT OR IGNORE INTO laps (session_id, lap_number, lap_time, sector1, sector2, sector3, valid, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    sessionId,
    lap.lapNumber,
    lap.lapTime,
    lap.sectorTimes[0] ?? null,
    lap.sectorTimes[1] ?? null,
    lap.sectorTimes[2] ?? null,
    lap.valid ? 1 : 0,
  );

  // Update session best lap
  db.prepare(`
    UPDATE sessions SET
      best_lap = CASE WHEN best_lap IS NULL OR ? < best_lap THEN ? ELSE best_lap END,
      lap_count = lap_count + 1
    WHERE id = ?
  `).run(lap.lapTime, lap.lapTime, sessionId);
}

// ──────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  setupPipeline();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  reader?.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  reader?.stop();
});
