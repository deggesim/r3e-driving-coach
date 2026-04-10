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

import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { createR3EReader, type R3EReader } from "./r3e/r3e-reader";
import { createLapRecorder, type LapRecorder } from "./r3e/lap-recorder";
import { createZoneTracker } from "./r3e/zone-tracker";
import {
  createAdaptiveBaseline,
  type AdaptiveBaseline,
} from "./coach/adaptive-baseline";
import { createAlertDispatcher, createRuleEngine } from "./coach/rule-engine";
import { createCoachEngine } from "./coach/coach-engine";
import {
  createVoiceCoachEngine,
  type VoiceCoachEngine,
} from "./coach/voice-coach";
import {
  getAzureVoices,
  synthesizeAzure,
  transcribeAzure,
} from "./tts/azure-tts";
import { getDb, seedCornerNames, getCornerName } from "./db/db";
import type {
  LapRecord,
  LapAnalysis,
  R3EStatus,
  R3EFrame,
  Alert,
  Deviation,
} from "../shared/types";
import cornerNamesData from "../shared/corner-names.json";

const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let reader: R3EReader | null = null;

// ──────────────────────────────────────────────
// Window creation
// ──────────────────────────────────────────────

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "../../public/icon.png"),
    frame: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Allow microphone access for Web Speech API (SpeechRecognition)
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      callback(permission === "media");
    },
  );

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

ipcMain.on("window:close", () => {
  mainWindow?.close();
});

ipcMain.on("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

// ──────────────────────────────────────────────
// Push helpers
// ──────────────────────────────────────────────

const pushToRenderer = (channel: string, data: unknown): void => {
  mainWindow?.webContents.send(channel, data);
};

// ──────────────────────────────────────────────
// Setup pipeline
// ──────────────────────────────────────────────

const setupPipeline = (): void => {
  const userDataPath = app.getPath("userData");
  const db = getDb(userDataPath);

  seedCornerNames(
    db,
    cornerNamesData as Record<
      string,
      Array<{ distMin: number; distMax: number; name: string }>
    >,
  );

  let currentTrack = "";
  let currentLayout = "";
  let lastDeviations: Deviation[] | null = null;

  const lookupCorner = (dist: number): string | null =>
    getCornerName(db, currentTrack, currentLayout, dist);

  const buildCornerMap = (): Map<number, string> => {
    const map = new Map<number, string>();
    for (let d = 0; d < 6000; d += 50) {
      const name = lookupCorner(d);
      if (name) map.set(Math.floor(d / 50), name);
    }
    return map;
  };

  // Components
  const dispatcher = createAlertDispatcher();
  const zoneTracker = createZoneTracker();

  // Placeholder baseline (will be recreated when car/track is known)
  let baseline: AdaptiveBaseline = createAdaptiveBaseline(
    "unknown",
    "unknown",
    db,
  );
  let ruleEngine = createRuleEngine(dispatcher, baseline, lookupCorner);

  const recorder = createLapRecorder(baseline.isReady());

  const coachEngine = createCoachEngine({
    db,
    onAnalysis: (analysis: LapAnalysis) => {
      pushToRenderer("r3e:analysis", analysis);
    },
  });

  // VoiceCoach engine — lazy init on first voice query (needs API key from config)
  let voiceCoach: VoiceCoachEngine | null = null;

  const getVoiceCoach = (): VoiceCoachEngine | null => {
    const row = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("anthropicApiKey") as { value: string } | undefined;
    const apiKey = row?.value;
    if (!apiKey) return null;

    if (!voiceCoach) {
      voiceCoach = createVoiceCoachEngine(db, apiKey);
    }
    return voiceCoach;
  };

  // Alert dispatcher → renderer
  dispatcher.on("alert", (alert: Alert) => {
    pushToRenderer("r3e:alert", alert);
  });

  // Session tracking
  let currentSessionId: number | null = null;

  // ─── Reader
  reader = createR3EReader();

  reader.on("connected", () => {
    pushStatus(recorder);
  });

  reader.on("disconnected", () => {
    pushStatus(recorder);
  });

  reader.on("frame", (frame: R3EFrame) => {
    if (frame.trackName) currentTrack = frame.trackName;
    if (frame.layoutName) currentLayout = frame.layoutName;

    zoneTracker.update(frame);
    ruleEngine.processFrame(frame);
    pushToRenderer("r3e:frame", frame);
  });

  reader.on("lapComplete", async (lapData) => {
    if (lapData.car !== baseline.car || lapData.track !== baseline.track) {
      baseline = createAdaptiveBaseline(lapData.car, lapData.track, db);
      ruleEngine = createRuleEngine(dispatcher, baseline, lookupCorner);
      coachEngine.updateCornerNames(buildCornerMap());
    }

    zoneTracker.reset();
    ruleEngine.resetLap();

    if (!currentSessionId) {
      currentSessionId = createSession(
        db,
        lapData.car,
        lapData.track,
        lapData.layout,
      );
    }
    saveLap(db, currentSessionId, lapData as LapRecord);
  });

  // ─── LapRecorder
  recorder.attach(reader);

  recorder.on(
    "lapRecorded",
    async (lap: LapRecord, { calibrating }: { calibrating: boolean }) => {
      pushToRenderer("r3e:lapComplete", lap);
      pushStatus(recorder);

      const deviations = baseline.ingestLap(
        lap.zones,
        lap.lapNumber,
        calibrating,
      );

      if (deviations && deviations.length > 0) {
        ruleEngine.processLapDeviations(deviations);
      }

      // Keep last deviations for voice coach context
      lastDeviations = deviations;

      // Update voice coach context with the completed lap
      const zonesJson = JSON.stringify(lap.zones);
      const cornerMap = buildCornerMap();
      voiceCoach?.updateContext({
        car: lap.car,
        track: lap.track,
        layout: lap.layout,
        lastLapZones: zonesJson,
        deviations: lastDeviations,
        cornerMap,
      });

      if (!calibrating) {
        const apiKey = ipcMain.emit(
          "config:get",
          null,
          "anthropicApiKey",
        ) as unknown as string;
        if (apiKey) coachEngine.updateApiKey(apiKey);
        coachEngine.analyzeLap(lap, deviations).catch(console.error);
      }
    },
  );

  recorder.on("calibrationComplete", () => {
    pushStatus(recorder);
  });

  // ─── Config IPC (API key)
  ipcMain.handle("config:get", (_event, key: string) => {
    return db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
  });

  ipcMain.handle("config:set", (_event, key: string, value: unknown) => {
    db.prepare(
      "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
    ).run(key, String(value));

    // Invalidate voice coach on API key change so it re-initializes
    if (key === "anthropicApiKey") voiceCoach = null;
  });

  // ─── DB IPC
  ipcMain.handle(
    "db:getLaps",
    (_event, { car, track }: { car: string; track: string }) => {
      return db
        .prepare(
          `
      SELECT l.* FROM laps l
      JOIN sessions s ON l.session_id = s.id
      WHERE s.car = ? AND s.track = ?
      ORDER BY l.recorded_at DESC
      LIMIT 200
    `,
        )
        .all(car, track);
    },
  );

  ipcMain.handle("db:getSession", (_event, id: number) => {
    return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  });

  // ─── Azure TTS IPC
  ipcMain.handle("tts:getVoices", async () => {
    const keyRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureSpeechKey") as { value: string } | undefined;
    const regionRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureRegion") as { value: string } | undefined;

    const key = keyRow?.value;
    const region = regionRow?.value;

    if (!key || !region) {
      throw new Error("Azure Speech Key e Region non configurati");
    }

    return getAzureVoices(key, region);
  });

  ipcMain.handle("tts:synthesize", async (_event, text: string) => {
    const keyRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureSpeechKey") as { value: string } | undefined;
    const regionRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureRegion") as { value: string } | undefined;
    const voiceRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureVoiceName") as { value: string } | undefined;

    const key = keyRow?.value;
    const region = regionRow?.value;
    const voice = voiceRow?.value;

    if (!key || !region || !voice) {
      throw new Error("Azure TTS non completamente configurato");
    }

    const buffer = await synthesizeAzure(text, key, region, voice);
    // Return as Uint8Array so it can be transferred via IPC (Buffers serialize fine)
    return buffer;
  });

  ipcMain.handle("tts:test", async (_event, voiceName: string) => {
    const keyRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureSpeechKey") as { value: string } | undefined;
    const regionRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureRegion") as { value: string } | undefined;
    const nameRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("assistantName") as { value: string } | undefined;

    const key = keyRow?.value;
    const region = regionRow?.value;
    const assistantName = nameRow?.value ?? "Aria";

    if (!key || !region) {
      throw new Error("Azure Speech Key e Region non configurati");
    }

    const testPhrase = `Ciao, sono ${assistantName} e oggi sono il tuo insegnante virtuale`;
    const buffer = await synthesizeAzure(testPhrase, key, region, voiceName);
    return buffer;
  });

  // ─── Azure STT IPC
  ipcMain.handle("stt:transcribe", async (_event, audioBuffer: ArrayBuffer) => {
    const keyRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureSpeechKey") as { value: string } | undefined;
    const regionRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureRegion") as { value: string } | undefined;

    const key = keyRow?.value;
    const region = regionRow?.value;

    if (!key || !region) {
      throw new Error(
        "Azure Speech Key e Region non configurati nelle impostazioni",
      );
    }

    return transcribeAzure(Buffer.from(audioBuffer), key, region);
  });

  // ─── Voice Query IPC
  ipcMain.handle("coach:voiceQuery", async (_event, question: string) => {
    const coach = getVoiceCoach();
    if (!coach) {
      pushToRenderer("coach:voiceDone", {
        answer:
          "API Key Anthropic non configurata. Vai nelle impostazioni per aggiungerla.",
      });
      return;
    }

    // Update corner map before answering
    coach.updateContext({ cornerMap: buildCornerMap() });

    let fullAnswer =
      "Si è verificato un errore durante l'elaborazione della domanda.";
    try {
      fullAnswer = await coach.handleVoiceQuery(question, (token) => {
        pushToRenderer("coach:voiceChunk", { token });
      });
    } catch (err) {
      console.error("[VoiceCoach] Error:", err);
    }

    pushToRenderer("coach:voiceDone", { answer: fullAnswer });

    // If Azure TTS is enabled, synthesize the answer and push the audio
    const azureEnabledRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureTtsEnabled") as { value: string } | undefined;

    if (azureEnabledRow?.value === "true") {
      try {
        const keyRow = db
          .prepare("SELECT value FROM app_config WHERE key = ?")
          .get("azureSpeechKey") as { value: string } | undefined;
        const regionRow = db
          .prepare("SELECT value FROM app_config WHERE key = ?")
          .get("azureRegion") as { value: string } | undefined;
        const voiceRow = db
          .prepare("SELECT value FROM app_config WHERE key = ?")
          .get("azureVoiceName") as { value: string } | undefined;

        const key = keyRow?.value;
        const region = regionRow?.value;
        const voice = voiceRow?.value;

        if (key && region && voice) {
          const audioBuffer = await synthesizeAzure(
            fullAnswer,
            key,
            region,
            voice,
          );
          pushToRenderer("coach:voiceAudio", { audio: audioBuffer });
        }
      } catch (err) {
        console.error("[VoiceCoach] TTS synthesis error:", err);
      }
    }
  });

  // Start reader
  reader.start();

  pushStatus(recorder);

  // Re-push status once the renderer has finished loading its IPC listeners.
  // reader.start() is synchronous — the 'connected' event fires before the
  // renderer mounts useIPC, so the first pushStatus is lost. This ensures the
  // renderer receives the correct state after load.
  mainWindow?.webContents.once("did-finish-load", () => {
    pushStatus(recorder);
  });
};

// ──────────────────────────────────────────────
// Status push
// ──────────────────────────────────────────────

const pushStatus = (recorder: LapRecorder): void => {
  const status: R3EStatus = {
    connected: reader !== null,
    calibrating: recorder.isCalibrating(),
    lapsToCalibration: recorder.lapsToCalibration(),
    car: null,
    track: null,
    layout: null,
  };
  pushToRenderer("r3e:status", status);
};

// ──────────────────────────────────────────────
// SQLite session/lap helpers
// ──────────────────────────────────────────────

import type BetterSqlite3 from "better-sqlite3";

const createSession = (
  db: BetterSqlite3.Database,
  car: string,
  track: string,
  layout: string,
): number => {
  const result = db
    .prepare(
      `
    INSERT INTO sessions (car, track, layout, session_type, started_at)
    VALUES (?, ?, ?, 'practice', datetime('now'))
  `,
    )
    .run(car, track, layout);
  return result.lastInsertRowid as number;
};

const saveLap = (
  db: BetterSqlite3.Database,
  sessionId: number,
  lap: LapRecord,
): void => {
  db.prepare(
    `
    INSERT OR IGNORE INTO laps (session_id, lap_number, lap_time, sector1, sector2, sector3, valid, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `,
  ).run(
    sessionId,
    lap.lapNumber,
    lap.lapTime,
    lap.sectorTimes[0] ?? null,
    lap.sectorTimes[1] ?? null,
    lap.sectorTimes[2] ?? null,
    lap.valid ? 1 : 0,
  );

  db.prepare(
    `
    UPDATE sessions SET
      best_lap = CASE WHEN best_lap IS NULL OR ? < best_lap THEN ? ELSE best_lap END,
      lap_count = lap_count + 1
    WHERE id = ?
  `,
  ).run(lap.lapTime, lap.lapTime, sessionId);
};

// ──────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  setupPipeline();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  reader?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  reader?.stop();
});
