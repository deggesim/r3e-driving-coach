/**
 * Electron main process entry point.
 *
 * Session-centric architecture:
 * - User explicitly starts/ends sessions (button or voice command).
 * - Laps persist under the current session; no auto-session creation.
 * - Analyses are on-demand (voice or button), versioned per session.
 * - Setups are cumulative per session and tagged on subsequent laps.
 */

import type BetterSqlite3 from "better-sqlite3";
import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { gzipSync, gunzipSync } from "zlib";
import { fileURLToPath } from "url";
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
  seedCornersFromLap,
} from "./db/db.js";
import { buildTrackMap } from "./coach/track-map-builder.js";
import { toGameFrame } from "./game-adapter.js";
import {
  generatePdfBuffer,
  generateSessionPdfBuffer,
  type PdfData,
} from "./pdf-generator.js";
import { createLapRecorder } from "./r3e/lap-recorder.js";
import {
  getCarClassName,
  getCarName,
  getLayoutName,
  getTrackName,
  loadR3EData,
} from "./r3e/r3e-data-loader.js";
import { createR3EReader, type R3EReader } from "./r3e/r3e-reader.js";
import { createZoneTracker } from "./r3e/zone-tracker.js";
import {
  getAzureVoices,
  synthesizeAzure,
  transcribeAzure,
} from "./tts/azure-tts.js";

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
  };
};

// ──────────────────────────────────────────────
// Setup pipeline
// ──────────────────────────────────────────────

const setupPipeline = (): void => {
  const userDataPath = app.getPath("userData");
  const db = getDb(userDataPath);

  loadR3EData();

  console.log(`[Main] setupPipeline — dual-reader mode`);

  // Live reader state
  let currentCar = "";
  let currentTrack = "";
  let currentLayout = "";
  let r3eConnected = false;
  let aceConnected = false;
  let activeGame: GameSource = "r3e";

  // Session lifecycle state
  let currentSessionId: number | null = null;
  let currentSetupId: number | null = null;
  let currentLapNumber = 0;
  let lastDeviations: Deviation[] | null = null;

  const lookupCorner = (dist: number): string | null => {
    if (activeGame === "ace") {
      return getCornerName(db, currentTrack, currentLayout, dist);
    }
    return getCornerName(
      db,
      currentTrack ? getTrackName(Number(currentTrack)) : currentTrack,
      currentLayout ? getLayoutName(Number(currentLayout)) : currentLayout,
      dist,
    );
  };

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

  const getAnthropicApiKey = (): string | undefined => {
    const row = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("anthropicApiKey") as { value: string } | undefined;
    return row?.value;
  };

  const getAnthropicModel = (): string => {
    const row = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("anthropicModel") as { value: string } | undefined;
    return row?.value ?? "claude-haiku-4-5-20251001";
  };

  const sessionCoach = createSessionCoachEngine({
    db,
    apiKey: getAnthropicApiKey(),
    model: getAnthropicModel(),
    onChunk: (data) => pushToRenderer("session:analysisChunk", data),
    onDone: (data) => pushToRenderer("session:analysisDone", data),
  });

  let voiceCoach: VoiceCoachEngine | null = null;
  const getVoiceCoach = (): VoiceCoachEngine | null => {
    const row = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("anthropicApiKey") as { value: string } | undefined;
    const apiKey = row?.value;
    if (!apiKey) return null;
    if (!voiceCoach) {
      voiceCoach = createVoiceCoachEngine(db, apiKey, getAnthropicModel());
    }
    return voiceCoach;
  };

  const sessionAlerts: Alert[] = [];

  dispatcher.on("alert", (alert: Alert) => {
    sessionAlerts.push(alert);
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

    const setups: SessionSetupRow[] = setupsRaw.map((r) => {
      let setup: SetupData;
      try {
        setup = JSON.parse(r.setup_json) as SetupData;
      } catch {
        setup = {
          carVerified: false,
          carFound: "",
          setupText: "",
          params: [],
          screenshots: [],
        };
      }
      return {
        id: r.id,
        session_id: r.session_id,
        loaded_at: r.loaded_at,
        setup,
        setup_screenshots: r.setup_screenshots,
      };
    });

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
    const game = activeGame;
    try {
      db.prepare(
        `UPDATE ${t("sessions")} SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL`,
      ).run(id);
    } catch (err) {
      console.error("[Main] closeSession error:", err);
    }
    console.log(`[Main] session closed (${reason}) id=${id}`);
    currentSessionId = null;
    currentSetupId = null;
    pushToRenderer("session:closed", { id, game });
  };

  const saveLap = (sessionId: number, lap: LapRecord): void => {
    const lapsTable = t("laps");
    const sessionsTable = t("sessions");
    try {
      // Downsample frames to ~30Hz (reader polls at ~60Hz) and gzip
      const downsampled = lap.frames.filter((_, i) => i % 2 === 0);
      const framesBlob = gzipSync(Buffer.from(JSON.stringify(downsampled), "utf8"));

      const insertResult = db
        .prepare(
          `INSERT INTO ${lapsTable}
           (session_id, setup_id, lap_number, lap_time, sector1, sector2, sector3, valid, zones_json, frames_blob, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .run(
          sessionId,
          currentSetupId,
          lap.lapNumber,
          lap.lapTime,
          lap.sectorTimes[0] ?? null,
          lap.sectorTimes[1] ?? null,
          lap.sectorTimes[2] ?? null,
          lap.valid ? 1 : 0,
          JSON.stringify(lap.zones),
          framesBlob,
        );

      db.prepare(
        `UPDATE ${sessionsTable} SET
           best_lap = CASE WHEN best_lap IS NULL OR ? < best_lap THEN ? ELSE best_lap END,
           lap_count = lap_count + 1
         WHERE id = ?`,
      ).run(lap.lapTime, lap.lapTime, sessionId);

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
    pushStatus();
  });

  r3eReader.on("r3e:frame", (frame: R3EFrame) => {
    if (frame.carModelId > 0) currentCar = String(frame.carModelId);
    if (frame.trackId > 0) currentTrack = String(frame.trackId);
    if (frame.layoutId > 0) currentLayout = String(frame.layoutId);

    const gameFrame = toGameFrame(frame);
    if (currentSessionId) {
      zoneTracker.update(gameFrame);
      ruleEngine.processFrame(gameFrame, currentLapNumber);
    }
    pushToRenderer("session:frame", frame);
  });

  aceReader.on("ace:frame", (frame: GameFrame) => {
    // Populate car as soon as the first AC_LIVE frame makes it available
    if (!currentCar) {
      const info = aceReader.getSessionInfo();
      if (info.car) {
        currentCar = info.car;
        pushStatus();
      }
    }
    if (currentSessionId) {
      zoneTracker.update(frame);
      ruleEngine.processFrame(frame, currentLapNumber);
    }
    pushToRenderer("session:frame", frame);
  });

  const handleLapComplete = (lapData: LapRecord, game: GameSource): void => {
    if (activeGame !== game) return;
    console.log(
      `[Main] ${game}:lapComplete — lap=${lapData.lapNumber} time=${lapData.lapTime.toFixed(3)}s ` +
        `valid=${lapData.valid} car="${lapData.car}" track="${lapData.track}" layout="${lapData.layout}"`,
    );

    if (game === "ace") {
      if (lapData.car) currentCar = lapData.car;
      if (lapData.track) currentTrack = lapData.track;
      if (lapData.layout) currentLayout = lapData.layout;
    }

    // Baseline/rule engine reset (per-car/track)
    if (lapData.car !== baseline.car || lapData.track !== baseline.track) {
      baseline = createAdaptiveBaseline(
        lapData.car,
        lapData.track,
        db,
        activeGame,
      );
      ruleEngine = createRuleEngine(dispatcher, baseline, lookupCorner);
      sessionCoach.updateCornerNames(buildCornerMap());
    }

    zoneTracker.reset();

    // Auto-close session if car/track/layout differ from the current session's
    if (currentSessionId) {
      const sessionRow = db
        .prepare(`SELECT car, track, layout FROM ${t("sessions")} WHERE id = ?`)
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
      if (!hasCornerNames(db, names.trackName, names.layoutName)) {
        seedCornersFromLap(db, names.trackName, names.layoutName, lap.zones);
      }

      // Build track map geometry from the first valid lap on this car/track/layout
      if (lap.valid) {
        const existing = getTrackMap(
          db,
          activeGame,
          lap.car,
          lap.track,
          lap.layout,
        );
        if (!existing) {
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

  // ──────────────────────────────────────────────
  // Config IPC
  // ──────────────────────────────────────────────

  ipcMain.handle("config:get", (_event, key: string) => {
    return db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
  });

  ipcMain.handle("config:set", (_event, key: string, value: unknown) => {
    db.prepare(
      "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
    ).run(key, String(value));
    if (key === "anthropicApiKey" || key === "anthropicModel")
      voiceCoach = null;
  });

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
           VALUES (?, ?, ?, 'practice', datetime('now'))`,
        )
        .run(currentCar, currentTrack, currentLayout);
      currentSessionId = Number(result.lastInsertRowid);
      currentSetupId = null;
      sessionAlerts.length = 0;

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
    (_event, { setup }: { setup: SetupData }) => {
      if (!currentSessionId) {
        throw new Error(
          "Nessuna sessione attiva. Apri una sessione prima di caricare un setup.",
        );
      }
      const result = db
        .prepare(
          `INSERT INTO ${t("session_setups")} (session_id, loaded_at, setup_json, setup_screenshots)
           VALUES (?, datetime('now'), ?, ?)`,
        )
        .run(
          currentSessionId,
          JSON.stringify(setup),
          activeGame === "ace" ? null : JSON.stringify(setup.screenshots ?? []),
        );
      const setupId = Number(result.lastInsertRowid);
      currentSetupId = setupId;

      const row: SessionSetupRow = {
        id: setupId,
        session_id: currentSessionId,
        loaded_at: new Date().toISOString(),
        setup,
        setup_screenshots:
          activeGame === "ace" ? null : JSON.stringify(setup.screenshots ?? []),
      };
      pushToRenderer("session:setupLoaded", {
        sessionId: currentSessionId,
        game: activeGame,
        setup: row,
      });
      return { setupId };
    },
  );

  ipcMain.handle(
    "session:analyze",
    async (_event, params: { sessionId?: number; game?: GameSource } = {}) => {
      const sessionId = params.sessionId ?? currentSessionId;
      const game = params.game ?? activeGame;
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

      const alertsForSession =
        sessionId === currentSessionId ? [...sessionAlerts] : undefined;
      sessionCoach
        .analyzeSession(sessionId, game, resolved, alertsForSession)
        .catch((err) => console.error("[SessionCoach] error:", err));

      return { ok: true };
    },
  );

  ipcMain.handle("session:getCurrent", () => {
    if (!currentSessionId) return null;
    return loadSessionDetail(currentSessionId, activeGame);
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
      const game = params.game ?? null;
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
        ? `SELECT *, '${game}' AS _game FROM ${t("sessions", game)} ${w.sql}`
        : `SELECT *, 'r3e' AS _game FROM sessions_r3e ${w.sql}
           UNION ALL
           SELECT *, 'ace' AS _game FROM sessions_ace ${w.sql}`;

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
    "session:exportPdf",
    async (_event, { id, game }: { id: number; game: GameSource }) => {
      const { dialog } = await import("electron");
      const fs = await import("fs");

      const detail = loadSessionDetail(id, game);
      if (!detail) return null;

      const pdfBuffer = await generateSessionPdfBuffer(detail);
      const filenameSafe = (
        detail.session.car_name ?? detail.session.car
      ).replace(/\s+/g, "_");
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Salva PDF sessione",
        defaultPath: `sessione_${id}_${filenameSafe}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (canceled || !filePath) return null;
      fs.writeFileSync(filePath, pdfBuffer);
      return filePath;
    },
  );

  // ──────────────────────────────────────────────
  // Azure TTS / STT IPC (unchanged)
  // ──────────────────────────────────────────────

  ipcMain.handle("tts:getVoices", async () => {
    const keyRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureSpeechKey") as { value: string } | undefined;
    const regionRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureRegion") as { value: string } | undefined;
    if (!keyRow?.value || !regionRow?.value)
      throw new Error("Azure Speech Key e Region non configurati");
    return getAzureVoices(keyRow.value, regionRow.value);
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
    if (!keyRow?.value || !regionRow?.value || !voiceRow?.value)
      throw new Error("Azure TTS non completamente configurato");
    return synthesizeAzure(text, keyRow.value, regionRow.value, voiceRow.value);
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
    if (!keyRow?.value || !regionRow?.value)
      throw new Error("Azure Speech Key e Region non configurati");
    const assistantName = nameRow?.value ?? "Aria";
    const testPhrase = `Ciao, sono ${assistantName} e oggi sono il tuo assistente in pista.`;
    return synthesizeAzure(
      testPhrase,
      keyRow.value,
      regionRow.value,
      voiceName,
    );
  });

  ipcMain.handle(
    "stt:transcribe",
    async (_event, audioBuffer: ArrayBuffer, mimeType?: string) => {
      const keyRow = db
        .prepare("SELECT value FROM app_config WHERE key = ?")
        .get("azureSpeechKey") as { value: string } | undefined;
      const regionRow = db
        .prepare("SELECT value FROM app_config WHERE key = ?")
        .get("azureRegion") as { value: string } | undefined;
      if (!keyRow?.value || !regionRow?.value)
        throw new Error("Azure Speech Key e Region non configurati");
      const buf = Buffer.from(audioBuffer);
      return transcribeAzure(buf, keyRow.value, regionRow.value, mimeType);
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
      /\b(analizza|analisi|valuta|valutazione|esegui\s+analisi)\b[\s\S]*\b(session|giri|ultimi\s+giri)\b/.test(
        s,
      ) ||
      /\banalizza\s+gli\s+ultimi\s+giri\b/.test(s)
    )
      return "analyze";
    return "freeform";
  };

  const speakText = async (text: string): Promise<void> => {
    pushToRenderer("coach:voiceDone", { answer: text });
    const azureEnabledRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureTtsEnabled") as { value: string } | undefined;
    if (azureEnabledRow?.value !== "true") return;
    const keyRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureSpeechKey") as { value: string } | undefined;
    const regionRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureRegion") as { value: string } | undefined;
    const voiceRow = db
      .prepare("SELECT value FROM app_config WHERE key = ?")
      .get("azureVoiceName") as { value: string } | undefined;
    if (!keyRow?.value || !regionRow?.value || !voiceRow?.value) return;
    try {
      const audio = await synthesizeAzure(
        text,
        keyRow.value,
        regionRow.value,
        voiceRow.value,
      );
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
        .prepare(`SELECT car, track, layout FROM ${t("sessions")} WHERE id = ?`)
        .get(currentSessionId) as
        | { car: string; track: string; layout: string }
        | undefined;
      const resolved = sRow
        ? resolveNames(activeGame, sRow.car, sRow.track, sRow.layout)
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
      const detail = loadSessionDetail(currentSessionId, activeGame);
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

  // ──────────────────────────────────────────────
  // Setup decoding IPC (produces SetupData — caller passes to session:loadSetup)
  // ──────────────────────────────────────────────

  ipcMain.handle("setup:listScreenshots", async () => {
    const fs = await import("fs");
    const pathMod = await import("path");
    const screenshotsDir =
      "C:/Program Files (x86)/Steam/userdata/11234306/760/remote/211500/screenshots";
    const thumbnailsDir = pathMod.join(screenshotsDir, "thumbnails");
    try {
      const files = fs
        .readdirSync(screenshotsDir)
        .filter((f: string) => /\.(jpg|jpeg|png)$/i.test(f))
        .sort()
        .reverse();
      return files.map((name: string) => {
        const thumbPath = pathMod.join(thumbnailsDir, name);
        const fullPath = pathMod.join(screenshotsDir, name);
        const src = fs.existsSync(thumbPath) ? thumbPath : fullPath;
        const thumbnailB64 = fs.readFileSync(src).toString("base64");
        return { name, thumbnailB64 };
      });
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "setup:decodeSetup",
    async (
      _event,
      { filenames, expectedCar }: { filenames: string[]; expectedCar: string },
    ) => {
      const fs = await import("fs");
      const pathMod = await import("path");
      const screenshotsDir =
        "C:/Program Files (x86)/Steam/userdata/11234306/760/remote/211500/screenshots";

      const apiKey = getAnthropicApiKey();
      if (!apiKey) throw new Error("Anthropic API Key non configurata");

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });

      const imageContents = filenames.map((name) => {
        const fullPath = pathMod.join(screenshotsDir, name);
        const data = fs.readFileSync(fullPath).toString("base64");
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: "image/jpeg" as const,
            data,
          },
        };
      });

      const systemPrompt = `Sei un esperto di setup per i simulatori di guida RaceRoom Racing Experience (R3E) e Assetto Corsa EVO (ACE).
Analizza le schermate del setup dell'auto e restituisci un JSON con questa struttura esatta:
{
  "carVerified": boolean,
  "carFound": "nome auto trovato nelle schermate",
  "setupText": "riepilogo markdown del setup",
  "params": [
    { "category": "categoria", "parameter": "nome parametro", "value": "valore" }
  ]
}
Devi verificare se l'auto nelle schermate corrisponde a: "${expectedCar}".
Estrai TUTTI i parametri di setup visibili: sospensioni, freni, aerodinamica, trasmissione, gomme, elettronica, ecc.
Restituisci solo il JSON, senza testo aggiuntivo.`;

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              ...imageContents,
              {
                type: "text" as const,
                text: `Analizza queste ${filenames.length} schermate del setup e restituisci il JSON.`,
              },
            ],
          },
        ],
      });

      const raw =
        response.content[0].type === "text" ? response.content[0].text : "{}";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      return {
        carVerified: parsed.carVerified ?? false,
        carFound: parsed.carFound ?? "",
        setupText: parsed.setupText ?? "",
        params: parsed.params ?? [],
        screenshots: filenames,
      };
    },
  );

  // ACE setup file-based IPC (unchanged)
  ipcMain.handle(
    "ace:listSetupFiles",
    async (_event, { car, track }: { car: string; track: string }) => {
      const fs = await import("fs");
      const pathMod = await import("path");
      const ACE_SETUPS_BASE = "D:\\Salvataggi\\ACE\\Car Setups";
      const dir = pathMod.join(ACE_SETUPS_BASE, car, track);
      try {
        const files = fs
          .readdirSync(dir)
          .filter((f: string) => f.endsWith(".carsetup"))
          .sort()
          .reverse();
        return files.map((filename: string): AceSetupFileInfo => {
          const filePath = pathMod.join(dir, filename);
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
    async (_event, { filePath }: { filePath: string }) => {
      const fs = await import("fs");
      const pathMod = await import("path");
      const buf = fs.readFileSync(filePath);
      const parts = filePath.split(/[\\/]/);
      const carIdx = parts.findIndex((p) => p.toLowerCase() === "car setups");
      const carId =
        carIdx >= 0
          ? (parts[carIdx + 1] ?? "")
          : pathMod.basename(pathMod.dirname(pathMod.dirname(filePath)));
      return decodeCarSetup(buf, carId);
    },
  );

  ipcMain.handle("ace:listSetupCars", async () => {
    const fs = await import("fs");
    const pathMod = await import("path");
    const ACE_SETUPS_BASE = "D:\\Salvataggi\\ACE\\Car Setups";
    try {
      return fs
        .readdirSync(ACE_SETUPS_BASE)
        .filter((f: string) =>
          fs.statSync(pathMod.join(ACE_SETUPS_BASE, f)).isDirectory(),
        )
        .sort();
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "ace:listSetupTracks",
    async (_event, { car }: { car: string }) => {
      const fs = await import("fs");
      const pathMod = await import("path");
      const ACE_SETUPS_BASE = "D:\\Salvataggi\\ACE\\Car Setups";
      const carDir = pathMod.join(ACE_SETUPS_BASE, car);
      try {
        return fs
          .readdirSync(carDir)
          .filter((f: string) =>
            fs.statSync(pathMod.join(carDir, f)).isDirectory(),
          )
          .sort();
      } catch {
        return [];
      }
    },
  );

  // Start both readers
  r3eReader.start();
  aceReader.start();
  pushStatus();

  mainWindow?.webContents.once("did-finish-load", () => {
    pushStatus();
  });
};

// ──────────────────────────────────────────────
// Suppress unused warnings (kept for future per-lap exports)
// ──────────────────────────────────────────────
void generatePdfBuffer;
void ([] as PdfData[]);
void ({} as BetterSqlite3.Database);

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
  r3eReaderInst?.stop();
  aceReaderInst?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  r3eReaderInst?.stop();
  aceReaderInst?.stop();
});
