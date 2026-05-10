/**
 * Electron main process entry point.
 *
 * Session-centric architecture:
 * - User explicitly starts/ends sessions (button or voice command).
 * - Laps persist under the current session; no auto-session creation.
 * - Analyses are on-demand (voice or button), versioned per session.
 * - Setups are cumulative per session and tagged on subsequent laps.
 */

import { app, BrowserWindow, ipcMain, shell } from "electron";
import { createInputManager, type InputManager } from "./input-manager.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync, gzipSync } from "zlib";
import type {
  Alert,
  Deviation,
  GameFrame,
  GameSource,
  GameStatus,
  LapRecord,
  LapRow,
  R3EFrame,
  SessionAnalysisRow,
  SessionDetail,
  SessionListParams,
  SessionListResult,
  SessionRow,
  SessionSetupRow,
  SessionStartResult,
  SetupData,
} from "../shared/types.js";
import { createAceReader, type AceReader } from "./ace/ace-reader.js";
import {
  decodeCarSetup,
  type AceSetupFileInfo,
} from "./ace/ace-setup-reader.js";
import {
  createAdaptiveBaseline,
  type AdaptiveBaseline,
} from "./coach/adaptive-baseline.js";
import {
  createAlertDispatcher,
  createRuleEngine,
} from "./coach/rule-engine.js";
import { createSessionCoachEngine } from "./coach/session-coach.js";
import { buildTrackMap } from "./coach/track-map-builder.js";
import {
  createVoiceCoachEngine,
  type VoiceCoachEngine,
} from "./coach/voice-coach.js";
import {
  getCornerName,
  getDb,
  getTrackMap,
  hasCornerNames,
  saveTrackMap,
  seedAceCornersFromR3E,
  seedCornersFromLap,
} from "./db/db.js";
import { toGameFrame } from "./game-adapter.js";
import { createLapRecorder } from "./lap-recorder.js";
import { generateSessionPdfBuffer } from "./pdf-generator.js";
import { parseSetupRow } from "./db/setup-row.js";
import {
  getCarClassName,
  getCarName,
  getLayoutName,
  getTrackName,
  loadR3EData,
} from "./r3e/r3e-data-loader.js";
import { createR3EReader, type R3EReader } from "./r3e/r3e-reader.js";
import {
  getAzureVoices,
  synthesizeAzure,
  transcribeAzure,
} from "./tts/azure-tts.js";
import { createZoneTracker } from "./zone-tracker.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let r3eReaderInst: R3EReader | null = null;
let aceReaderInst: AceReader | null = null;

// ──────────────────────────────────────────────
// Window creation
// ──────────────────────────────────────────────

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "../../build/icon.ico"),
    frame: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep timers running at full rate when the window is not focused so
      // that navigator.getGamepads() polling in the renderer keeps working
      // while the user is driving in the simulator.
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.session.setPermissionCheckHandler(
    (_wc, permission) => permission === "media",
  );
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      callback(permission === "media");
    },
  );

  // Content Security Policy — blocks XSS from injected HTML (e.g. marked output)
  const csp = IS_DEV
    ? [
        "default-src 'self' http://localhost:5173",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:5173",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src blob:",
        "connect-src ws://localhost:5173 http://localhost:5173",
        "font-src 'self' data:",
      ].join("; ")
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src blob:",
        "connect-src 'none'",
        "font-src 'self' data:",
      ].join("; ");

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  // Block navigation to external URLs; redirect them to the system browser.
  // Prevents markdown links in analysis text from hijacking the app window.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedOrigins = IS_DEV
      ? ["http://localhost:5173"]
      : [`file://${path.join(__dirname, "../renderer")}`];
    if (!allowedOrigins.some((o) => url.startsWith(o))) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  // Deny all attempts to open a new window (e.g. target="_blank" in markdown).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  if (IS_DEV) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

// ──────────────────────────────────────────────
// Window control IPC
// ──────────────────────────────────────────────

ipcMain.on("window:close", () => mainWindow?.close());
ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});

const pushToRenderer = (channel: string, data: unknown): void => {
  mainWindow?.webContents.send(channel, data);
};

// ──────────────────────────────────────────────
// Name resolution helpers (R3E numeric IDs → names; ACE: passthrough)
// ──────────────────────────────────────────────

const resolveNames = (
  game: GameSource,
  car: string,
  track: string,
  layout: string,
): {
  carName: string;
  trackName: string;
  layoutName: string;
  carClassName: string;
} => {
  if (game === "ace") {
    return {
      carName: car,
      trackName: track,
      layoutName: layout,
      carClassName: "",
    };
  }
  const carNum = Number(car);
  const trackNum = Number(track);
  const layoutNum = Number(layout);
  return {
    carName: !isNaN(carNum) ? getCarName(carNum) : car,
    trackName: !isNaN(trackNum) ? getTrackName(trackNum) : track,
    layoutName: !isNaN(layoutNum) ? getLayoutName(layoutNum) : layout,
    carClassName: !isNaN(carNum) ? getCarClassName(carNum) : "",
  };
};

const enrichSession = (
  row: Record<string, unknown>,
  game: GameSource,
): SessionRow => {
  const names = resolveNames(
    game,
    row.car as string,
    row.track as string,
    row.layout as string,
  );
  return {
    id: row.id as number,
    game,
    car: row.car as string,
    track: row.track as string,
    layout: row.layout as string,
    session_type: row.session_type as string,
    started_at: row.started_at as string,
    ended_at: (row.ended_at as string | null) ?? null,
    best_lap: (row.best_lap as number | null) ?? null,
    lap_count: row.lap_count as number,
    car_name: names.carName,
    track_name: names.trackName,
    layout_name: names.layoutName,
    car_class_name: names.carClassName,
    analysis_count:
      typeof row.analysis_count === "number" ? row.analysis_count : undefined,
  };
};

// ──────────────────────────────────────────────
// Setup pipeline
// ──────────────────────────────────────────────

const setupPipeline = (): void => {
  const userDataPath = app.getPath("userData");
  const db = getDb(userDataPath);

  const getConfig = (key: string): string | undefined =>
    (db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as { value: string } | undefined)?.value;

  // Register config handlers immediately — renderer may call configGet before
  // the rest of setupPipeline (readers, baseline, etc.) finishes initializing.
  ipcMain.handle("config:get", (_event, key: string) => {
    return db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
  });

  let inputManager: InputManager | null = null;

  ipcMain.handle("config:set", (_event, key: string, value: unknown) => {
    db.prepare(
      "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
    ).run(key, String(value));
    if (key === "anthropicApiKey" || key === "anthropicModel")
      voiceCoach = null;
    if (key === "telemetryLogEnabled") {
      telemetryEnabled = String(value) === "true";
      if (!telemetryEnabled) closeTelemetryFile();
    }
    if (key === "keyboardVoiceKey") {
      inputManager?.setKeyboard(String(value) || null);
    }
  });

  loadR3EData();

  // ── Telemetry logger ─────────────────────────────────────────────────────────
  const telemetryLogDir = path.join(userDataPath, "telemetry");

  let telemetryEnabled = getConfig("telemetryLogEnabled") === "true";

  let telemetryStream: ReturnType<typeof fs.createWriteStream> | null = null;
  let telemetryCurrentPath: string | null = null;

  const openTelemetryFile = (game: GameSource, car: string, track: string, layout: string): void => {
    if (!telemetryEnabled || telemetryStream) return;
    if (!fs.existsSync(telemetryLogDir)) fs.mkdirSync(telemetryLogDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_");
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    let carLabel = car, trackLabel = track, layoutLabel = layout;
    if (game === "r3e") {
      carLabel = getCarName(Number(car)) || car;
      trackLabel = getTrackName(Number(track)) || track;
      layoutLabel = getLayoutName(Number(layout)) || layout;
    }
    const filename = `${ts}-${game}-${sanitize(carLabel)}-${sanitize(trackLabel)}-${sanitize(layoutLabel)}.jsonl`;
    telemetryCurrentPath = path.join(telemetryLogDir, filename);
    telemetryStream = fs.createWriteStream(telemetryCurrentPath, { flags: "w" });
    console.log(`[Main] Telemetry log opened: ${telemetryCurrentPath}`);
  };

  const closeTelemetryFile = (): void => {
    if (telemetryStream) {
      telemetryStream.end();
      telemetryStream = null;
      console.log(`[Main] Telemetry log closed: ${telemetryCurrentPath}`);
    }
  };

  const writeFrame = (frame: object): void => {
    telemetryStream?.write(JSON.stringify(frame) + "\n");
  };
  // ─────────────────────────────────────────────────────────────────────────────

  console.log(`[Main] setupPipeline — dual-reader mode`);

  // Live reader state
  let currentCar = "";
  let currentTrack = "";
  let currentLayout = "";
  let currentLayoutLength = 6000;
  let r3eConnected = false;
  let aceConnected = false;
  let activeGame: GameSource = "r3e";

  // Session lifecycle state
  let currentSessionId: number | null = null;
  let currentSessionGame: GameSource = "r3e";
  let currentSetupId: number | null = null;
  let currentLapNumber = 0;
  let lastDeviations: Deviation[] | null = null;

  const lookupCorner = (dist: number): string | null => {
    if (activeGame === "ace") {
      return getCornerName(db, "ace", currentTrack, currentLayout, dist);
    }
    return getCornerName(
      db,
      "r3e",
      currentTrack ? getTrackName(Number(currentTrack)) : currentTrack,
      currentLayout ? getLayoutName(Number(currentLayout)) : currentLayout,
      dist,
    );
  };

  const buildCornerMap = (): Map<number, string> => {
    const map = new Map<number, string>();
    const limit = Math.max(currentLayoutLength, 6000);
    for (let d = 0; d < limit; d += 50) {
      const name = lookupCorner(d);
      if (name) map.set(Math.floor(d / 50), name);
    }
    return map;
  };

  // Components
  const dispatcher = createAlertDispatcher();
  const zoneTracker = createZoneTracker();

  let baseline: AdaptiveBaseline = createAdaptiveBaseline(
    "unknown",
    "unknown",
    db,
    activeGame,
  );
  let ruleEngine = createRuleEngine(dispatcher, baseline, lookupCorner);

  const recorder = createLapRecorder(baseline.isReady());

  const pushStatus = (): void => {
    const names =
      activeGame === "ace"
        ? {
            carName: currentCar,
            trackName: currentTrack,
            layoutName: currentLayout,
          }
        : {
            carName: currentCar ? getCarName(Number(currentCar)) : "",
            trackName: currentTrack ? getTrackName(Number(currentTrack)) : "",
            layoutName: currentLayout
              ? getLayoutName(Number(currentLayout))
              : "",
          };
    const status: GameStatus = {
      connected: r3eConnected || aceConnected,
      r3eConnected,
      aceConnected,
      calibrating: recorder.isCalibrating(),
      lapsToCalibration: recorder.lapsToCalibration(),
      car: names.carName || null,
      track: names.trackName || null,
      layout: names.layoutName || null,
      game: activeGame,
    };
    pushToRenderer("status", status);
  };

  const getAnthropicApiKey = (): string | undefined => getConfig("anthropicApiKey");
  const getAnthropicModel = (): string => getConfig("anthropicModel") ?? "claude-haiku-4-5-20251001";

  const sessionCoach = createSessionCoachEngine({
    db,
    apiKey: getAnthropicApiKey(),
    model: getAnthropicModel(),
    onChunk: (data) => pushToRenderer("session:analysisChunk", data),
    onDone: (data) => pushToRenderer("session:analysisDone", data),
  });
  const analyzingInProgress = new Set<string>();

  let voiceCoach: VoiceCoachEngine | null = null;
  const getVoiceCoach = (): VoiceCoachEngine | null => {
    const apiKey = getConfig("anthropicApiKey");
    if (!apiKey) return null;
    if (!voiceCoach) {
      voiceCoach = createVoiceCoachEngine(db, apiKey, getAnthropicModel());
    }
    return voiceCoach;
  };

  const MAX_SESSION_ALERTS = 500;
  const sessionAlerts: Alert[] = [];

  dispatcher.on("alert", (alert: Alert) => {
    sessionAlerts.push(alert);
    if (sessionAlerts.length > MAX_SESSION_ALERTS) {
      sessionAlerts.splice(0, sessionAlerts.length - MAX_SESSION_ALERTS);
    }
  });

  // ──────────────────────────────────────────────
  // Session DB helpers (inline closures — need db + game + push)
  // ──────────────────────────────────────────────

  const t = (base: string, game: GameSource = activeGame): string =>
    `${base}_${game === "ace" ? "ace" : "r3e"}`;

  const loadSessionDetail = (
    sessionId: number,
    game: GameSource,
  ): SessionDetail | null => {
    const raw = db
      .prepare(`SELECT * FROM ${t("sessions", game)} WHERE id = ?`)
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!raw) return null;

    const session = enrichSession(raw, game);

    const laps = db
      .prepare(
        `SELECT id, session_id, setup_id, lap_number, lap_time, sector1, sector2, sector3, valid, zones_json, recorded_at
         FROM ${t("laps", game)} WHERE session_id = ? ORDER BY lap_number ASC`,
      )
      .all(sessionId) as LapRow[];

    const setupsRaw = db
      .prepare(
        `SELECT * FROM ${t("session_setups", game)} WHERE session_id = ? ORDER BY loaded_at ASC, id ASC`,
      )
      .all(sessionId) as Array<{
      id: number;
      session_id: number;
      loaded_at: string;
      setup_json: string;
      setup_screenshots: string | null;
    }>;

    const setups: SessionSetupRow[] = setupsRaw.map(parseSetupRow);

    const analyses = db
      .prepare(
        `SELECT * FROM ${t("session_analyses", game)} WHERE session_id = ? ORDER BY version ASC`,
      )
      .all(sessionId) as SessionAnalysisRow[];

    return { session, laps, setups, analyses };
  };

  const closeSession = (reason: string): void => {
    if (!currentSessionId) return;
    const id = currentSessionId;
    const game = currentSessionGame;
    try {
      db.prepare(
        `UPDATE ${t("sessions", currentSessionGame)} SET ended_at = ? WHERE id = ? AND ended_at IS NULL`,
      ).run(new Date().toISOString(), id);
    } catch (err) {
      console.error("[Main] closeSession error:", err);
    }
    console.log(`[Main] session closed (${reason}) id=${id}`);
    currentSessionId = null;
    currentSetupId = null;
    pushToRenderer("session:closed", { id, game });
  };

  const saveLap = (sessionId: number, lap: LapRecord): void => {
    const lapsTable = t("laps", currentSessionGame);
    const sessionsTable = t("sessions", currentSessionGame);
    try {
      const framesBlob = gzipSync(
        Buffer.from(JSON.stringify(lap.frames), "utf8"),
      );

      const insertResult = db
        .prepare(
          `INSERT INTO ${lapsTable}
           (session_id, setup_id, lap_number, lap_time, sector1, sector2, sector3, valid, zones_json, frames_blob, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          currentSetupId,
          lap.lapNumber,
          lap.lapTime,
          lap.sectorTimes[0] > 0 ? lap.sectorTimes[0] : null,
          lap.sectorTimes[1] > 0 ? lap.sectorTimes[1] : null,
          lap.sectorTimes[2] > 0 ? lap.sectorTimes[2] : null,
          lap.valid ? 1 : 0,
          JSON.stringify(lap.zones),
          framesBlob,
          new Date().toISOString(),
        );

      db.prepare(
        `UPDATE ${sessionsTable} SET
           best_lap = CASE WHEN ? AND (best_lap IS NULL OR ? < best_lap) THEN ? ELSE best_lap END,
           lap_count = lap_count + 1
         WHERE id = ?`,
      ).run(lap.valid ? 1 : 0, lap.lapTime, lap.lapTime, sessionId);

      // Push lap added (exclude frames_blob — renderer fetches on demand)
      const lapRow = db
        .prepare(
          `SELECT id, session_id, setup_id, lap_number, lap_time, sector1, sector2, sector3, valid, zones_json, recorded_at
           FROM ${lapsTable} WHERE id = ?`,
        )
        .get(insertResult.lastInsertRowid) as LapRow | undefined;
      if (lapRow) {
        pushToRenderer("session:lapAdded", {
          sessionId,
          game: activeGame,
          lap: lapRow,
        });
      }
    } catch (err) {
      console.error("[Main] saveLap error:", err);
    }
  };

  // ──────────────────────────────────────────────
  // Reader lifecycle — both readers run in parallel
  // ──────────────────────────────────────────────

  const r3eReader = createR3EReader();
  const aceReader = createAceReader();
  r3eReaderInst = r3eReader;
  aceReaderInst = aceReader;

  r3eReader.on("connected", () => {
    r3eConnected = true;
    if (!aceConnected) activeGame = "r3e";
    pushStatus();
  });

  r3eReader.on("disconnected", () => {
    r3eConnected = false;
    if (aceConnected) activeGame = "ace";
    closeTelemetryFile();
    pushStatus();
  });

  aceReader.on("connected", () => {
    aceConnected = true;
    if (!r3eConnected) activeGame = "ace";
    // Track/layout come from StaticEvo and are available immediately on connect
    const info = aceReader.getSessionInfo();
    if (info.track) currentTrack = info.track;
    if (info.layout) currentLayout = info.layout;
    if (info.car) currentCar = info.car;
    pushStatus();
  });

  aceReader.on("disconnected", () => {
    aceConnected = false;
    if (r3eConnected) activeGame = "r3e";
    closeTelemetryFile();
    pushStatus();
  });

  r3eReader.on("r3e:frame", (frame: R3EFrame) => {
    if (frame.carModelId > 0) currentCar = String(frame.carModelId);
    if (frame.trackId > 0) currentTrack = String(frame.trackId);
    if (frame.layoutId > 0) currentLayout = String(frame.layoutId);

    if (telemetryEnabled && activeGame === "r3e") {
      if (!telemetryStream && frame.carModelId > 0 && frame.trackId > 0) {
        openTelemetryFile("r3e", String(frame.carModelId), String(frame.trackId), String(frame.layoutId));
      }
      writeFrame(frame);
    }

    const gameFrame = toGameFrame(frame);
    if (currentSessionId) {
      zoneTracker.update(gameFrame);
      ruleEngine.processFrame(gameFrame, currentLapNumber);
    }
    pushToRenderer("session:frame", frame);
  });

  aceReader.on("ace:frame", (frame: GameFrame) => {
    // Update car/track/layout from every AC_LIVE frame, re-syncing when StaticEvo
    // was not yet populated at connect time (app launched before ACE session loads).
    const info = aceReader.getSessionInfo();
    let statusDirty = false;
    if (info.car && info.car !== currentCar) {
      currentCar = info.car;
      statusDirty = true;
    }
    if (info.track && info.track !== currentTrack) {
      currentTrack = info.track;
      statusDirty = true;
    }
    if (info.layout && info.layout !== currentLayout) {
      currentLayout = info.layout;
      statusDirty = true;
    }
    if (statusDirty) {
      pushStatus();
    }
    if (currentSessionId) {
      zoneTracker.update(frame);
      ruleEngine.processFrame(frame, currentLapNumber);
    }
    pushToRenderer("session:frame", frame);
  });

  aceReader.on("ace:fullFrame", (frame: Record<string, unknown>) => {
    if (telemetryEnabled && activeGame === "ace") {
      if (!telemetryStream && frame.car) {
        openTelemetryFile("ace", frame.car as string, frame.track as string, frame.layout as string);
      }
      writeFrame(frame);
    }
  });

  const handleLapComplete = (lapData: LapRecord, game: GameSource): void => {
    if (activeGame !== game) return;
    if (currentSessionId !== null && currentSessionGame !== game) return;
    console.log(
      `[Main] ${game}:lapComplete — lap=${lapData.lapNumber} time=${lapData.lapTime.toFixed(3)}s ` +
        `valid=${lapData.valid} car="${lapData.car}" track="${lapData.track}" layout="${lapData.layout}"`,
    );

    if (game === "ace") {
      if (lapData.car) currentCar = lapData.car;
      if (lapData.track) currentTrack = lapData.track;
      if (lapData.layout) currentLayout = lapData.layout;
    }
    if (lapData.layoutLength > 0) currentLayoutLength = lapData.layoutLength;

    // Baseline/rule engine reset (per-car/track)
    if (lapData.car !== baseline.car || lapData.track !== baseline.track) {
      baseline = createAdaptiveBaseline(
        lapData.car,
        lapData.track,
        db,
        activeGame,
      );
      ruleEngine = createRuleEngine(dispatcher, baseline, lookupCorner);
      recorder.reset(baseline.isReady());
      sessionCoach.updateCornerNames(buildCornerMap());
    }

    zoneTracker.reset();

    // Auto-close session if car/track/layout differ from the current session's
    if (currentSessionId) {
      const sessionRow = db
        .prepare(`SELECT car, track, layout FROM ${t("sessions", currentSessionGame)} WHERE id = ?`)
        .get(currentSessionId) as
        | { car: string; track: string; layout: string }
        | undefined;
      if (
        sessionRow &&
        (sessionRow.car !== lapData.car ||
          sessionRow.track !== lapData.track ||
          sessionRow.layout !== lapData.layout)
      ) {
        closeSession("car/track changed");
      }
    }

    // Only persist if an explicit session is open
    if (currentSessionId) {
      saveLap(currentSessionId, lapData as LapRecord);
    }
  };

  r3eReader.on("lapComplete", (lapData) =>
    handleLapComplete(lapData as LapRecord, "r3e"),
  );
  aceReader.on("lapComplete", (lapData) =>
    handleLapComplete(lapData as LapRecord, "ace"),
  );

  recorder.attach(r3eReader);
  recorder.attach(aceReader);

  recorder.on(
    "lapRecorded",
    async (lap: LapRecord, { calibrating }: { calibrating: boolean }) => {
      console.log(
        `[Main] recorder:lapRecorded — lap=${lap.lapNumber} calibrating=${calibrating}`,
      );

      const names = resolveNames(activeGame, lap.car, lap.track, lap.layout);
      const lapWithNames: LapRecord = {
        ...lap,
        game: activeGame,
        carName: names.carName,
        trackName: names.trackName,
        layoutName: names.layoutName,
      };

      currentLapNumber = lap.lapNumber;
      pushToRenderer("lapComplete", lapWithNames);
      pushStatus();

      // Seed corner names from first lap on a new track/layout
      if (!hasCornerNames(db, activeGame, names.trackName, names.layoutName)) {
        seedCornersFromLap(db, activeGame, names.trackName, names.layoutName, lap.zones);
      }

      // Build track map geometry from the first valid lap on this car/track/layout
      if (lap.valid) {
        const geometry = buildTrackMap(lap.frames, lap.layoutLength);
        if (geometry) {
          saveTrackMap(
            db,
            activeGame,
            lap.car,
            lap.track,
            lap.layout,
            geometry,
          );
          console.log(
            `[Main] trackMap saved — game=${activeGame} car=${lap.car} ` +
              `track=${lap.track} layout=${lap.layout} samples=${geometry.sampleCount}`,
          );
        }
      }

      const deviations = baseline.ingestLap(
        lap.zones,
        lap.lapNumber,
        calibrating,
      );
      if (currentSessionId && deviations && deviations.length > 0) {
        ruleEngine.processLapDeviations(deviations, lap.lapNumber);
      }
      lastDeviations = deviations;

      // Update voice coach context (full session view refreshed on demand)
      const zonesJson = JSON.stringify(lapWithNames.zones);
      voiceCoach?.updateContext({
        game: activeGame,
        car: lapWithNames.car,
        track: lapWithNames.track,
        layout: lapWithNames.layout,
        carName: lapWithNames.carName,
        trackName: lapWithNames.trackName,
        layoutName: lapWithNames.layoutName,
        lastLapZones: zonesJson,
        deviations: lastDeviations,
        cornerMap: buildCornerMap(),
        alerts: [...sessionAlerts],
      });
    },
  );

  recorder.on("calibrationComplete", () => {
    pushStatus();
  });

  ipcMain.handle("telemetry:getLogDir", () => telemetryLogDir);

  // ──────────────────────────────────────────────
  // Session lifecycle IPC
  // ──────────────────────────────────────────────

  const startSession = (): SessionStartResult => {
    if (!r3eConnected && !aceConnected) {
      return {
        ok: false,
        reason:
          "Nessun simulatore connesso. Avvia RaceRoom o Assetto Corsa EVO prima di aprire una sessione.",
      };
    }
    console.log(
      `[startSession] activeGame="${activeGame}" car="${currentCar}" track="${currentTrack}" layout="${currentLayout}"`,
    );
    const layoutRequired = activeGame === "r3e";
    if (!currentCar || !currentTrack || (layoutRequired && !currentLayout)) {
      return {
        ok: false,
        reason: "Auto/circuito non ancora rilevati. Entra in pista e riprova.",
      };
    }
    if (currentSessionId) {
      // Close the existing session (explicit intent: new session)
      closeSession("new session requested");
    }

    try {
      const result = db
        .prepare(
          `INSERT INTO ${t("sessions")} (car, track, layout, session_type, started_at)
           VALUES (?, ?, ?, 'practice', ?)`,
        )
        .run(currentCar, currentTrack, currentLayout, new Date().toISOString());
      currentSessionId = Number(result.lastInsertRowid);
      currentSessionGame = activeGame;
      currentSetupId = null;
      sessionAlerts.length = 0;

      if (activeGame === "ace") {
        seedAceCornersFromR3E(db, currentTrack, currentLayout);
      }

      const row = db
        .prepare(`SELECT * FROM ${t("sessions")} WHERE id = ?`)
        .get(currentSessionId) as Record<string, unknown>;
      const session = enrichSession(row, activeGame);
      pushToRenderer("session:started", session);
      return { ok: true, sessionId: currentSessionId, game: activeGame };
    } catch (err) {
      console.error("[Main] startSession error:", err);
      return { ok: false, reason: String(err) };
    }
  };

  ipcMain.handle("session:start", () => startSession());

  ipcMain.handle("session:end", () => {
    if (!currentSessionId) return;
    closeSession("user ended");
  });

  ipcMain.handle(
    "session:loadSetup",
    (_event, { setup, sessionId: sid, game: g }: { setup: SetupData; sessionId?: number; game?: GameSource }) => {
      const targetId = sid ?? currentSessionId;
      const targetGame = g ?? currentSessionGame;
      if (!targetId) {
        throw new Error(
          "Nessuna sessione attiva. Apri una sessione prima di caricare un setup.",
        );
      }
      const result = db
        .prepare(
          `INSERT INTO ${t("session_setups", targetGame)} (session_id, loaded_at, setup_json, setup_screenshots)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          targetId,
          new Date().toISOString(),
          JSON.stringify(setup),
          targetGame === "ace" ? null : JSON.stringify(setup.screenshots ?? []),
        );
      const setupId = Number(result.lastInsertRowid);
      // Only advance currentSetupId when loading into the current live session
      if (targetId === currentSessionId) currentSetupId = setupId;

      const row: SessionSetupRow = {
        id: setupId,
        session_id: targetId,
        loaded_at: new Date().toISOString(),
        setup,
        setup_screenshots:
          targetGame === "ace" ? null : JSON.stringify(setup.screenshots ?? []),
      };
      pushToRenderer("session:setupLoaded", {
        sessionId: targetId,
        game: targetGame,
        setup: row,
      });
      return { setupId };
    },
  );

  ipcMain.handle(
    "session:analyze",
    async (_event, params: { sessionId?: number; game?: GameSource; leaderboardMode?: boolean; fixedSetup?: boolean } = {}) => {
      const sessionId = params.sessionId ?? currentSessionId;
      const game = params.game ?? currentSessionGame;
      if (!sessionId) {
        return { ok: false, reason: "Nessuna sessione selezionata." };
      }
      const apiKey = getAnthropicApiKey();
      if (!apiKey) {
        return { ok: false, reason: "API Key Anthropic non configurata." };
      }
      sessionCoach.updateApiKey(apiKey);
      sessionCoach.updateCornerNames(buildCornerMap());

      // Resolve names for prompt
      const sRow = db
        .prepare(
          `SELECT car, track, layout FROM ${t("sessions", game)} WHERE id = ?`,
        )
        .get(sessionId) as
        | { car: string; track: string; layout: string }
        | undefined;
      const resolved = sRow
        ? resolveNames(game, sRow.car, sRow.track, sRow.layout)
        : undefined;

      const analyzeKey = `${sessionId}:${game}`;
      if (analyzingInProgress.has(analyzeKey)) {
        return { ok: false, reason: "Analisi già in corso per questa sessione." };
      }

      const alertsForSession =
        sessionId === currentSessionId ? [...sessionAlerts] : undefined;
      const flags = { leaderboardMode: params.leaderboardMode, fixedSetup: params.fixedSetup };

      analyzingInProgress.add(analyzeKey);
      sessionCoach
        .analyzeSession(sessionId, game, resolved, alertsForSession, flags)
        .catch((err) => console.error("[SessionCoach] error:", err))
        .finally(() => analyzingInProgress.delete(analyzeKey));

      return { ok: true };
    },
  );

  ipcMain.handle("session:getCurrent", () => {
    if (!currentSessionId) return null;
    return loadSessionDetail(currentSessionId, currentSessionGame);
  });

  ipcMain.handle(
    "session:getDetail",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      return loadSessionDetail(id, game);
    },
  );

  ipcMain.handle(
    "trackMap:get",
    (
      _event,
      {
        game,
        car,
        track,
        layout,
      }: { game: GameSource; car: string; track: string; layout: string },
    ) => {
      return getTrackMap(db, game, car, track, layout);
    },
  );

  ipcMain.handle(
    "lap:assignSetup",
    (_event, { lapId, setupId, game }: { lapId: number; setupId: number | null; game: GameSource }) => {
      const lapsTable = `laps_${game === "ace" ? "ace" : "r3e"}`;
      db.prepare(`UPDATE ${lapsTable} SET setup_id = ? WHERE id = ?`).run(setupId ?? null, lapId);
    },
  );

  ipcMain.handle(
    "lap:getFrames",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      const lapsTable = `laps_${game === "ace" ? "ace" : "r3e"}`;
      const row = db
        .prepare(`SELECT frames_blob FROM ${lapsTable} WHERE id = ?`)
        .get(id) as { frames_blob: Buffer | null } | undefined;
      if (!row || !row.frames_blob) return [];
      try {
        const json = gunzipSync(row.frames_blob).toString("utf8");
        return JSON.parse(json);
      } catch (err) {
        console.error("[Main] lap:getFrames decode error:", err);
        return [];
      }
    },
  );

  ipcMain.handle(
    "session:list",
    (_event, params: SessionListParams = {}): SessionListResult => {
      const page = params.page ?? 0;
      const pageSize = params.pageSize ?? 10;
      const sort = params.sort === "asc" ? "ASC" : "DESC";
      const rawGame = params.game ?? null;
      const game: GameSource | null =
        rawGame === "r3e" || rawGame === "ace" ? rawGame : null;
      const carFilter = params.car ?? null;
      const trackFilter = params.track ?? null;

      const buildWhere = (): { sql: string; args: unknown[] } => {
        const parts: string[] = [];
        const args: unknown[] = [];
        if (carFilter) {
          parts.push("car = ?");
          args.push(carFilter);
        }
        if (trackFilter) {
          parts.push("track = ?");
          args.push(trackFilter);
        }
        return {
          sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
          args,
        };
      };

      const w = buildWhere();

      const unionSql = game
        ? `SELECT s.*, '${game}' AS _game, (SELECT COUNT(*) FROM session_analyses_${game} WHERE session_id = s.id) AS analysis_count FROM ${t("sessions", game)} s ${w.sql}`
        : `SELECT s.*, 'r3e' AS _game, (SELECT COUNT(*) FROM session_analyses_r3e WHERE session_id = s.id) AS analysis_count FROM sessions_r3e s ${w.sql}
           UNION ALL
           SELECT s.*, 'ace' AS _game, (SELECT COUNT(*) FROM session_analyses_ace WHERE session_id = s.id) AS analysis_count FROM sessions_ace s ${w.sql}`;

      const countSql = `SELECT COUNT(*) AS c FROM (${unionSql})`;
      const countArgs = game ? w.args : [...w.args, ...w.args];
      const countRow = db.prepare(countSql).get(...countArgs) as { c: number };

      const pageSql = `
        SELECT * FROM (${unionSql})
        ORDER BY started_at ${sort}, id ${sort}
        LIMIT ? OFFSET ?
      `;
      const pageArgs = [...countArgs, pageSize, page * pageSize];
      const rows = db.prepare(pageSql).all(...pageArgs) as Array<
        Record<string, unknown> & { _game: string }
      >;

      const items = rows.map((r) =>
        enrichSession(r, r._game === "ace" ? "ace" : "r3e"),
      );

      return { items, total: countRow.c, page, pageSize };
    },
  );

  ipcMain.handle(
    "session:delete",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      db.prepare(`DELETE FROM ${t("sessions", game)} WHERE id = ?`).run(id);
      if (currentSessionId === id) {
        currentSessionId = null;
        currentSetupId = null;
      }
    },
  );

  ipcMain.handle(
    "session:deleteAll",
    (_event, items: Array<{ id: number; game: GameSource }>) => {
      const delR3e = db.prepare("DELETE FROM sessions_r3e WHERE id = ?");
      const delAce = db.prepare("DELETE FROM sessions_ace WHERE id = ?");
      db.transaction(() => {
        for (const { id, game } of items) {
          if (game === "ace") delAce.run(id);
          else delR3e.run(id);
          if (currentSessionId === id) {
            currentSessionId = null;
            currentSetupId = null;
          }
        }
      })();
    },
  );

  ipcMain.handle(
    "session:deleteAnalysis",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      db.prepare(`DELETE FROM ${t("session_analyses", game)} WHERE id = ?`).run(id);
    },
  );

  ipcMain.handle(
    "session:exportPdf",
    async (_event, { id, game }: { id: number; game: GameSource }) => {
      const { dialog } = await import("electron");

      const detail = loadSessionDetail(id, game);
      if (!detail) return null;

      const pdfBuffer = await generateSessionPdfBuffer(detail);
      const carLabel = detail.session.car_name ?? detail.session.car;
      const trackLabel = detail.session.track_name ?? detail.session.track;
      const d = new Date(detail.session.started_at);
      const dateLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const defaultFilename = `${dateLabel} - ${carLabel} - ${trackLabel}`;
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Salva PDF sessione",
        defaultPath: `${defaultFilename}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (canceled || !filePath) return null;
      fs.writeFileSync(filePath, pdfBuffer);
      return filePath;
    },
  );

  ipcMain.handle(
    "session:reopen",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      // Validation 1: the session's game must be connected
      const gameConnected = game === "ace" ? aceConnected : r3eConnected;
      if (!gameConnected) {
        const label = game === "ace" ? "Assetto Corsa EVO" : "RaceRoom";
        return {
          ok: false,
          reason: `${label} non è connesso. Avvia il simulatore prima di riaprire la sessione.`,
        };
      }

      // Validation 2: car/track/layout must match the current in-game values
      const sessionRow = db
        .prepare(`SELECT car, track, layout FROM ${t("sessions", game)} WHERE id = ?`)
        .get(id) as { car: string; track: string; layout: string } | undefined;
      if (!sessionRow) {
        return { ok: false, reason: "Sessione non trovata." };
      }

      if (
        sessionRow.car !== currentCar ||
        sessionRow.track !== currentTrack ||
        (game === "r3e" && sessionRow.layout !== currentLayout)
      ) {
        const names = resolveNames(game, sessionRow.car, sessionRow.track, sessionRow.layout);
        return {
          ok: false,
          reason: `Auto o circuito non corrispondono alla sessione. La sessione richiede ${names.carName} a ${names.trackName}${names.layoutName && names.layoutName !== names.trackName ? ` — ${names.layoutName}` : ""}, ma il simulatore ha rilevato ${resolveNames(game, currentCar, currentTrack, currentLayout).carName}.`,
        };
      }

      if (currentSessionId && currentSessionId !== id) {
        closeSession("reopen: different session requested");
      }
      try {
        db.prepare(
          `UPDATE ${t("sessions", game)} SET ended_at = NULL WHERE id = ?`,
        ).run(id);
      } catch (err) {
        console.error("[Main] session:reopen error:", err);
        return { ok: false, reason: String(err) };
      }

      currentSessionId = id;
      currentSessionGame = game;
      sessionAlerts.length = 0;

      // Restore last loaded setup
      const lastSetupRow = db
        .prepare(
          `SELECT id FROM ${t("session_setups", game)} WHERE session_id = ? ORDER BY loaded_at DESC, id DESC LIMIT 1`,
        )
        .get(id) as { id: number } | undefined;
      currentSetupId = lastSetupRow?.id ?? null;

      const raw = db
        .prepare(`SELECT * FROM ${t("sessions", game)} WHERE id = ?`)
        .get(id) as Record<string, unknown>;
      const session = enrichSession(raw, game);
      pushToRenderer("session:started", session);

      console.log(`[Main] session reopened id=${id} game=${game} setupId=${currentSetupId ?? "none"}`);
      return { ok: true, sessionId: id, game };
    },
  );

  ipcMain.handle(
    "session:getSetupHistory",
    (
      _event,
      {
        car,
        track,
        layout,
        game,
      }: { car: string; track: string; layout: string; game: GameSource },
    ) => {
      const setupsRaw = db
        .prepare(
          `SELECT ss.* FROM ${t("session_setups", game)} ss
           JOIN ${t("sessions", game)} s ON ss.session_id = s.id
           WHERE s.car = ? AND s.track = ? AND s.layout = ?
           ORDER BY ss.loaded_at DESC
           LIMIT 20`,
        )
        .all(car, track, layout) as Array<{
        id: number;
        session_id: number;
        loaded_at: string;
        setup_json: string;
        setup_screenshots: string | null;
      }>;

      return setupsRaw.map(parseSetupRow);
    },
  );

  // Reuse an existing setup row: just update currentSetupId, no new DB row
  ipcMain.handle(
    "session:reuseSetup",
    (_event, { setupId }: { setupId: number }) => {
      if (!currentSessionId) {
        throw new Error("Nessuna sessione attiva.");
      }
      currentSetupId = setupId;
    },
  );

  // ──────────────────────────────────────────────
  // Azure TTS / STT IPC (unchanged)
  // ──────────────────────────────────────────────

  ipcMain.handle("tts:getVoices", async () => {
    const key = getConfig("azureSpeechKey");
    const region = getConfig("azureRegion");
    if (!key || !region) throw new Error("Azure Speech Key e Region non configurati");
    return getAzureVoices(key, region);
  });

  ipcMain.handle("tts:synthesize", async (_event, text: string) => {
    const key = getConfig("azureSpeechKey");
    const region = getConfig("azureRegion");
    const voice = getConfig("azureVoiceName");
    if (!key || !region || !voice) throw new Error("Azure TTS non completamente configurato");
    return synthesizeAzure(text, key, region, voice);
  });

  ipcMain.handle("tts:test", async (_event, voiceName: string) => {
    const key = getConfig("azureSpeechKey");
    const region = getConfig("azureRegion");
    if (!key || !region) throw new Error("Azure Speech Key e Region non configurati");
    const assistantName = getConfig("assistantName") ?? "Aria";
    const testPhrase = `Ciao, sono ${assistantName} e oggi sono il tuo assistente in pista.`;
    return synthesizeAzure(testPhrase, key, region, voiceName);
  });

  ipcMain.handle(
    "stt:transcribe",
    async (_event, audioBuffer: ArrayBuffer, mimeType?: string) => {
      const key = getConfig("azureSpeechKey");
      const region = getConfig("azureRegion");
      if (!key || !region) throw new Error("Azure Speech Key e Region non configurati");
      return transcribeAzure(Buffer.from(audioBuffer), key, region, mimeType);
    },
  );

  // ──────────────────────────────────────────────
  // Voice query IPC — classifies intent, routes to session commands or freeform
  // ──────────────────────────────────────────────

  const classifyVoiceIntent = (
    q: string,
  ): "newSession" | "closeSession" | "analyze" | "freeform" => {
    const s = q.toLowerCase();
    const hasSession = /\bsession/.test(s);
    if (
      hasSession &&
      /\b(nuova|apri|inizia|inizio|avvia|avvio|comincia|crea|start|apre|partenza|parti)\b/.test(
        s,
      )
    )
      return "newSession";
    if (
      hasSession &&
      /\b(chiudi|termina|fine|ferma|concludi|stop|finisci|chiude)\b/.test(s)
    )
      return "closeSession";
    if (
      /\b(analizza|analisi|valuta|valutazione|esegui\s+analisi)\b[\s\S]*\b(sessione|giri|ultimi\s+giri)\b/.test(
        s,
      ) ||
      /\banalizza\s+gli\s+ultimi\s+giri\b/.test(s) ||
      /\b(analizza|analisi|valuta|valutazione|esegui\s+analisi)\b/.test(s)
    )
      return "analyze";
    return "freeform";
  };

  const speakText = async (text: string): Promise<void> => {
    pushToRenderer("coach:voiceDone", { answer: text });
    if (getConfig("azureTtsEnabled") !== "true") return;
    const key = getConfig("azureSpeechKey");
    const region = getConfig("azureRegion");
    const voice = getConfig("azureVoiceName");
    if (!key || !region || !voice) return;
    try {
      const audio = await synthesizeAzure(text, key, region, voice);
      pushToRenderer("coach:voiceAudio", { audio });
    } catch (err) {
      console.error("[VoiceCoach] TTS synthesis error:", err);
    }
  };

  ipcMain.handle("coach:voiceQuery", async (_event, question: string) => {
    console.log("[VoiceCoach] question:", question);
    const intent = classifyVoiceIntent(question);
    console.log("[VoiceCoach] intent:", intent);

    if (intent === "newSession") {
      const res = startSession();
      if (res.ok) {
        const names = resolveNames(
          activeGame,
          currentCar,
          currentTrack,
          currentLayout,
        );
        const car = names.carName || "auto sconosciuta";
        const track = names.trackName || "circuito sconosciuto";
        const layout =
          names.layoutName && names.layoutName !== track
            ? `, ${names.layoutName}`
            : "";
        await speakText(`Sessione aperta. ${car} — ${track}${layout}.`);
      } else {
        await speakText(`Impossibile aprire la sessione. ${res.reason}`);
      }
      return;
    }
    if (intent === "closeSession") {
      if (!currentSessionId) {
        await speakText("Non c'è nessuna sessione aperta.");
        return;
      }
      closeSession("voice command");
      await speakText("Sessione chiusa.");
      return;
    }
    if (intent === "analyze") {
      if (!currentSessionId) {
        await speakText("Non c'è nessuna sessione aperta da analizzare.");
        return;
      }
      const apiKey = getAnthropicApiKey();
      if (!apiKey) {
        await speakText("API Key Anthropic non configurata.");
        return;
      }
      sessionCoach.updateApiKey(apiKey);
      sessionCoach.updateCornerNames(buildCornerMap());
      const sRow = db
        .prepare(`SELECT car, track, layout FROM ${t("sessions", currentSessionGame)} WHERE id = ?`)
        .get(currentSessionId) as
        | { car: string; track: string; layout: string }
        | undefined;
      const resolved = sRow
        ? resolveNames(currentSessionGame, sRow.car, sRow.track, sRow.layout)
        : undefined;
      const analysis = await sessionCoach.analyzeSession(
        currentSessionId,
        activeGame,
        resolved,
        [...sessionAlerts],
      );
      if (analysis?.section5_summary) {
        await speakText(analysis.section5_summary);
      } else {
        await speakText("Analisi completata.");
      }
      return;
    }

    // Freeform
    const coach = getVoiceCoach();
    if (!coach) {
      await speakText("API Key Anthropic non configurata.");
      return;
    }
    coach.updateContext({ cornerMap: buildCornerMap() });
    // Extend context with full session view (setups + analyses)
    if (currentSessionId) {
      const detail = loadSessionDetail(currentSessionId, currentSessionGame);
      if (detail) {
        coach.updateContext({
          laps: detail.laps,
          // voice-coach reads analyses/setups from extended context (set via same updateContext)
        });
      }
    }

    let fullAnswer =
      "Si è verificato un errore durante l'elaborazione della domanda.";
    try {
      fullAnswer = await coach.handleVoiceQuery(question, (token) => {
        pushToRenderer("coach:voiceChunk", { token });
      });
    } catch (err) {
      console.error("[VoiceCoach] Error:", err);
    }
    await speakText(fullAnswer);
  });

  // ACE setup file-based IPC
  // getAceSetupsBase reads the user-configurable path from the DB, falling back
  // to the default installation path when the config key is not set.
  const ACE_SETUPS_DEFAULT = "D:\\Salvataggi\\ACE\\Car Setups";
  const getAceSetupsBase = (): string => getConfig("aceSetupsPath")?.trim() || ACE_SETUPS_DEFAULT;

  ipcMain.handle(
    "ace:listSetupFiles",
    (_event, { car, track }: { car: string; track: string }) => {
      const aceSetupsBase = getAceSetupsBase();
      const dir = path.join(aceSetupsBase, car, track);
      try {
        const files = fs
          .readdirSync(dir)
          .filter((f: string) => f.endsWith(".carsetup"))
          .sort()
          .reverse();
        return files.map((filename: string): AceSetupFileInfo => {
          const filePath = path.join(dir, filename);
          const stat = fs.statSync(filePath);
          return { filename, filePath, modifiedAt: stat.mtime.toISOString() };
        });
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    "ace:readSetup",
    (_event, { filePath }: { filePath: string }) => {
      const aceSetupsBase = getAceSetupsBase();
      const resolvedBase = path.resolve(aceSetupsBase);
      const resolvedPath = path.resolve(filePath);
      // Prevent path traversal: filePath must be inside the ACE setups directory
      if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
        throw new Error("Percorso file non consentito.");
      }
      const buf = fs.readFileSync(resolvedPath);
      const parts = resolvedPath.split(path.sep);
      const carIdx = parts.findIndex((p) => p.toLowerCase() === "car setups");
      const carId =
        carIdx >= 0
          ? (parts[carIdx + 1] ?? "")
          : path.basename(path.dirname(path.dirname(resolvedPath)));
      return decodeCarSetup(buf, carId);
    },
  );

  ipcMain.handle("ace:listSetupCars", () => {
    const aceSetupsBase = getAceSetupsBase();
    try {
      return fs
        .readdirSync(aceSetupsBase)
        .filter((f: string) => fs.statSync(path.join(aceSetupsBase, f)).isDirectory())
        .sort();
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "ace:listSetupTracks",
    (_event, { car }: { car: string }) => {
      const aceSetupsBase = getAceSetupsBase();
      const carDir = path.join(aceSetupsBase, car);
      try {
        return fs
          .readdirSync(carDir)
          .filter((f: string) => fs.statSync(path.join(carDir, f)).isDirectory())
          .sort();
      } catch {
        return [];
      }
    },
  );

  // Close any sessions left open by a previous crash or forced quit
  const crashCloseTs = new Date().toISOString();
  db.prepare(
    "UPDATE sessions_r3e SET ended_at = ? WHERE ended_at IS NULL",
  ).run(crashCloseTs);
  db.prepare(
    "UPDATE sessions_ace SET ended_at = ? WHERE ended_at IS NULL",
  ).run(crashCloseTs);

  // Global input listener — works even when the app window is not focused.
  inputManager = createInputManager(() => {
    pushToRenderer("input:trigger", {});
  });

  const kbKey = getConfig("keyboardVoiceKey");
  if (kbKey) inputManager.setKeyboard(kbKey);

  // Ensure the active session is closed and all resources released on exit.
  // This is the single before-quit handler; the module-level one has been removed
  // to avoid double execution of cleanup logic.
  app.on("before-quit", () => {
    closeSession("app closing");
    inputManager?.destroy();
    r3eReader.stop();
    aceReader.stop();
  });

  // Start both readers
  r3eReader.start();
  aceReader.start();
  pushStatus();

  mainWindow?.webContents.once("did-finish-load", () => {
    pushStatus();
  });
};

// ──────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────

app.whenReady().then(() => {
  // setupPipeline must run before createWindow so that all ipcMain.handle
  // registrations are in place before the renderer sends its first IPC calls.
  setupPipeline();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  r3eReaderInst?.stop();
  aceReaderInst?.stop();
  if (process.platform !== "darwin") app.quit();
});

// Note: reader stop on quit is handled by the before-quit listener in setupPipeline()
// which has direct closure access to r3eReader and aceReader instances.
// The r3eReaderInst / aceReaderInst module-level refs are kept for window-all-closed below.
