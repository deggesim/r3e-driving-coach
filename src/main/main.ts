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
import { generatePdfBuffer, type PdfData } from "./pdf-generator";
import { createR3EReader, type R3EReader } from "./r3e/r3e-reader";
import { createAceReader, type AceReader } from "./ace/ace-reader";
import { createLapRecorder } from "./r3e/lap-recorder";
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
import {
  loadR3EData,
  getCarName,
  getTrackName,
  getLayoutName,
  getCarClassName,
} from "./r3e/r3e-data-loader";
import { toGameFrame } from "./game-adapter";
import { decodeCarSetup, type AceSetupFileInfo } from "./ace/ace-setup-reader";
import type {
  LapRecord,
  LapAnalysis,
  R3EStatus,
  R3EFrame,
  GameSource,
  Alert,
  Deviation,
} from "../shared/types";
import cornerNamesData from "../shared/corner-names.json";

const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let reader: R3EReader | AceReader | null = null;

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
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Allow microphone access (needed for getUserMedia in sandboxed renderer).
  // setPermissionCheckHandler is the synchronous guard that runs before the
  // async setPermissionRequestHandler — both must allow "media".
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

  // Load r3e-data.json for ID → name resolution. Non-fatal if missing.
  loadR3EData();

  seedCornerNames(
    db,
    cornerNamesData as Record<
      string,
      Array<{ distMin: number; distMax: number; name: string }>
    >,
  );

  // Read active game from persistent config (default: 'r3e')
  const activeGameRow = db
    .prepare("SELECT value FROM app_config WHERE key = ?")
    .get("activeGame") as { value: string } | undefined;
  const activeGame: GameSource = activeGameRow?.value === "ace" ? "ace" : "r3e";

  console.log(`[Main] setupPipeline — activeGame="${activeGame}"`);

  let currentCar = "";
  let currentTrack = "";
  let currentLayout = "";
  let lastDeviations: Deviation[] | null = null;

  // corner_names seed data uses track/layout names.
  // R3E: resolve numeric IDs to display names before lookup.
  // ACE: car/track/layout are already readable strings — use directly.
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

  // Placeholder baseline (will be recreated when car/track is known)
  let baseline: AdaptiveBaseline = createAdaptiveBaseline(
    "unknown",
    "unknown",
    db,
    activeGame,
  );
  let ruleEngine = createRuleEngine(dispatcher, baseline, lookupCorner);

  const recorder = createLapRecorder(baseline.isReady());

  const pushStatus = (): void => {
    const status: R3EStatus =
      activeGame === "ace"
        ? {
            connected: reader !== null,
            calibrating: recorder.isCalibrating(),
            lapsToCalibration: recorder.lapsToCalibration(),
            car: currentCar || null,
            track: currentTrack || null,
            layout: currentLayout || null,
            game: activeGame,
          }
        : {
            connected: reader !== null,
            calibrating: recorder.isCalibrating(),
            lapsToCalibration: recorder.lapsToCalibration(),
            car: currentCar ? getCarName(Number(currentCar)) : null,
            track: currentTrack ? getTrackName(Number(currentTrack)) : null,
            layout: currentLayout ? getLayoutName(Number(currentLayout)) : null,
            game: activeGame,
          };
    pushToRenderer("r3e:status", status);
  };

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

  // ─── Reader (selected by activeGame config)
  reader = activeGame === "ace" ? createAceReader() : createR3EReader();

  reader.on("connected", () => {
    pushStatus();
  });

  reader.on("disconnected", () => {
    pushStatus();
  });

  if (activeGame === "ace") {
    // AceReader emits GameFrame directly — no projection needed.
    // car/track/layout are updated from lapComplete (not per-frame).
    reader.on("frame", (frame: import("../shared/types").GameFrame) => {
      zoneTracker.update(frame);
      ruleEngine.processFrame(frame);
      // Renderer still receives frame data for live telemetry display
      pushToRenderer("r3e:frame", frame);
    });
  } else {
    // R3EReader emits R3EFrame — project to GameFrame for shared components.
    reader.on("frame", (frame: R3EFrame) => {
      if (frame.carModelId > 0) currentCar = String(frame.carModelId);
      if (frame.trackId > 0) currentTrack = String(frame.trackId);
      if (frame.layoutId > 0) currentLayout = String(frame.layoutId);

      const gameFrame = toGameFrame(frame);
      zoneTracker.update(gameFrame);
      ruleEngine.processFrame(gameFrame);
      pushToRenderer("r3e:frame", frame);
    });
  }

  reader.on("lapComplete", async (lapData) => {
    console.log(
      `[Main] reader:lapComplete — lap=${lapData.lapNumber} time=${lapData.lapTime.toFixed(3)}s ` +
        `valid=${lapData.valid} car="${lapData.car}" track="${lapData.track}" layout="${lapData.layout}"`,
    );

    // For ACE, update current car/track/layout from lapComplete (not from per-frame data)
    if (activeGame === "ace") {
      if (lapData.car) currentCar = lapData.car;
      if (lapData.track) currentTrack = lapData.track;
      if (lapData.layout) currentLayout = lapData.layout;
    }

    if (lapData.car !== baseline.car || lapData.track !== baseline.track) {
      console.log(
        `[Main] car/track changed — recreating baseline (was car="${baseline.car}" track="${baseline.track}")`,
      );
      baseline = createAdaptiveBaseline(
        lapData.car,
        lapData.track,
        db,
        activeGame,
      );
      ruleEngine = createRuleEngine(dispatcher, baseline, lookupCorner);
      coachEngine.updateCornerNames(buildCornerMap());
    }

    zoneTracker.reset();
    ruleEngine.resetLap();

    if (!currentSessionId) {
      console.log(
        `[Main] no session yet — creating for car="${lapData.car}" track="${lapData.track}" layout="${lapData.layout}"`,
      );
      try {
        currentSessionId = createSession(
          db,
          lapData.car,
          lapData.track,
          lapData.layout,
          activeGame,
        );
        console.log(`[Main] session created: id=${currentSessionId}`);
      } catch (err) {
        console.error("[Main] createSession error:", err);
        return;
      }
    }
    saveLap(db, currentSessionId, lapData as LapRecord, activeGame);
  });

  // ─── LapRecorder
  recorder.attach(reader);

  recorder.on(
    "lapRecorded",
    async (lap: LapRecord, { calibrating }: { calibrating: boolean }) => {
      console.log(
        `[Main] recorder:lapRecorded — lap=${lap.lapNumber} time=${lap.lapTime.toFixed(3)}s ` +
          `valid=${lap.valid} calibrating=${calibrating} zones=${lap.zones.length}`,
      );

      // Resolve display names before sending to renderer and coach.
      // ACE: car/track/layout are already human-readable strings — use directly.
      // R3E: resolve numeric IDs to display names.
      const lapWithNames: LapRecord =
        activeGame === "ace"
          ? {
              ...lap,
              game: "ace",
              carName: lap.car,
              trackName: lap.track,
              layoutName: lap.layout,
            }
          : {
              ...lap,
              game: "r3e",
              carName: getCarName(Number(lap.car)),
              trackName: getTrackName(Number(lap.track)),
              layoutName: getLayoutName(Number(lap.layout)),
            };

      pushToRenderer("r3e:lapComplete", lapWithNames);
      pushStatus();

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
      const zonesJson = JSON.stringify(lapWithNames.zones);
      const cornerMap = buildCornerMap();
      voiceCoach?.updateContext({
        car: lapWithNames.car,
        track: lapWithNames.track,
        layout: lapWithNames.layout,
        carName: lapWithNames.carName,
        trackName: lapWithNames.trackName,
        layoutName: lapWithNames.layoutName,
        lastLapZones: zonesJson,
        deviations: lastDeviations,
        cornerMap,
      });

      if (!calibrating && lap.valid) {
        const apiKeyRow = db
          .prepare("SELECT value FROM app_config WHERE key = ?")
          .get("anthropicApiKey") as { value: string } | undefined;
        const apiKey = apiKeyRow?.value;
        console.log("apiKey", apiKey);
        if (apiKey) coachEngine.updateApiKey(apiKey);
        coachEngine.analyzeLap(lapWithNames, deviations).catch((err) => {
          console.error("[CoachEngine] Analysis error:", err);
        });
      }
    },
  );

  recorder.on("calibrationComplete", () => {
    pushStatus();
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

      UNION ALL

      SELECT l.* FROM laps_ace l
      JOIN sessions_ace s ON l.session_id = s.id
      WHERE s.car = ? AND s.track = ?

      ORDER BY recorded_at DESC
      LIMIT 200
    `,
        )
        .all(car, track, car, track);
    },
  );

  ipcMain.handle("db:getAllLaps", () => {
    const rows = db
      .prepare(
        `
      SELECT l.*, s.car, s.track, s.layout, s.game AS game
      FROM laps l
      JOIN sessions s ON l.session_id = s.id

      UNION ALL

      SELECT l.*, s.car, s.track, s.layout, 'ace' AS game
      FROM laps_ace l
      JOIN sessions_ace s ON l.session_id = s.id

      ORDER BY recorded_at DESC
      LIMIT 500
    `,
      )
      .all() as Array<{
      id: number;
      session_id: number;
      lap_number: number;
      lap_time: number;
      sector1: number | null;
      sector2: number | null;
      sector3: number | null;
      valid: number;
      analysis_json: string | null;
      pdf_path: string | null;
      setup_json: string | null;
      setup_screenshots: string | null;
      recorded_at: string;
      car: string;
      track: string;
      layout: string;
      game: string;
    }>;

    return rows.map((row) => {
      const isAce = row.game === "ace";
      const carNum = parseInt(row.car);
      const trackNum = parseInt(row.track);
      const layoutNum = parseInt(row.layout);
      return {
        ...row,
        car_name: (!isAce && !isNaN(carNum) ? getCarName(carNum) : undefined) ?? row.car,
        track_name: (!isAce && !isNaN(trackNum) ? getTrackName(trackNum) : undefined) ?? row.track,
        layout_name: (!isAce && !isNaN(layoutNum) ? getLayoutName(layoutNum) : undefined) ?? row.layout,
        car_class_name: (!isAce && !isNaN(carNum) ? getCarClassName(carNum) : undefined) ?? "",
      };
    });
  });

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
  ipcMain.handle(
    "stt:transcribe",
    async (_event, audioBuffer: ArrayBuffer, mimeType?: string) => {
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

      const buf = Buffer.from(audioBuffer);
      console.log(
        `[STT IPC] Received ${buf.byteLength} bytes, mimeType=${mimeType ?? "(default)"}`,
      );
      return transcribeAzure(buf, key, region, mimeType);
    },
  );

  // ─── Voice Query IPC
  ipcMain.handle("coach:voiceQuery", async (_event, question: string) => {
    console.log("question", question);

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

  // ─── Setup: list Steam screenshots
  ipcMain.handle("setup:listScreenshots", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const screenshotsDir =
      "C:/Program Files (x86)/Steam/userdata/11234306/760/remote/211500/screenshots";
    const thumbnailsDir = path.join(screenshotsDir, "thumbnails");
    try {
      const files = fs
        .readdirSync(screenshotsDir)
        .filter((f: string) => /\.(jpg|jpeg|png)$/i.test(f))
        .sort()
        .reverse();
      return files.map((name: string) => {
        const thumbPath = path.join(thumbnailsDir, name);
        const fullPath = path.join(screenshotsDir, name);
        const src = fs.existsSync(thumbPath) ? thumbPath : fullPath;
        const thumbnailB64 = fs.readFileSync(src).toString("base64");
        return { name, thumbnailB64 };
      });
    } catch {
      return [];
    }
  });

  // ─── Setup: decode setup from screenshots via Claude Vision
  ipcMain.handle(
    "setup:decodeSetup",
    async (
      _event,
      { filenames, expectedCar }: { filenames: string[]; expectedCar: string },
    ) => {
      const fs = await import("fs");
      const path = await import("path");
      const screenshotsDir =
        "C:/Program Files (x86)/Steam/userdata/11234306/760/remote/211500/screenshots";

      const apiKeyRow = db
        .prepare("SELECT value FROM app_config WHERE key = ?")
        .get("anthropicApiKey") as { value: string } | undefined;
      const apiKey = apiKeyRow?.value;
      if (!apiKey) throw new Error("Anthropic API Key non configurata");

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });

      const imageContents = filenames.map((name) => {
        const fullPath = path.join(screenshotsDir, name);
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

      const systemPrompt = `Sei un esperto di setup per simulatori di guida (RaceRoom Racing Experience / R3E).
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

  // ─── Setup: save setup data to DB for a lap
  ipcMain.handle(
    "setup:saveSetup",
    (
      _event,
      {
        lapId,
        setup,
      }: {
        lapId: number;
        setup: {
          carVerified: boolean;
          carFound: string;
          setupText: string;
          params: unknown[];
          screenshots: string[];
        };
      },
    ) => {
      db.prepare(
        "UPDATE laps SET setup_json = ?, setup_screenshots = ? WHERE id = ?",
      ).run(
        JSON.stringify({
          carVerified: setup.carVerified,
          carFound: setup.carFound,
          setupText: setup.setupText,
          params: setup.params,
        }),
        JSON.stringify(setup.screenshots),
        lapId,
      );
    },
  );

  // ─── Setup: export PDF with analysis + setup using branded template
  ipcMain.handle(
    "setup:exportPdf",
    async (_event, { lapId }: { lapId: number }) => {
      const { dialog } = await import("electron");
      const fs = await import("fs");

      const lap = db
        .prepare(
          `SELECT l.*, s.car, s.track, s.layout, s.session_type
         FROM laps l JOIN sessions s ON l.session_id = s.id
         WHERE l.id = ?`,
        )
        .get(lapId) as
        | {
            lap_number: number;
            lap_time: number;
            sector1: number | null;
            sector2: number | null;
            sector3: number | null;
            analysis_json: string | null;
            setup_json: string | null;
            car: string;
            track: string;
            layout: string;
            session_type: string;
            recorded_at: string;
          }
        | undefined;

      if (!lap) return null;

      const analysis = lap.analysis_json ? JSON.parse(lap.analysis_json) : null;
      const setup = lap.setup_json ? JSON.parse(lap.setup_json) : null;

      const sessionTypeMap: Record<string, string> = {
        practice: "Pratica",
        qualify: "Qualifica",
        race: "Gara",
      };

      const pdfData: PdfData = {
        car: lap.car,
        track: lap.track,
        layout: lap.layout,
        lapNumber: lap.lap_number,
        lapTime: lap.lap_time,
        sector1: lap.sector1,
        sector2: lap.sector2,
        sector3: lap.sector3,
        condition: "Asciutto",
        sessionType:
          sessionTypeMap[lap.session_type] ?? lap.session_type ?? "Sessione",
        recordedAt: lap.recorded_at,
        templateV3: analysis?.templateV3 ?? null,
        setupParams: setup?.params ?? undefined,
      };

      const pdfBuffer = await generatePdfBuffer(pdfData);

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Salva analisi PDF",
        defaultPath: `giro${lap.lap_number}_car${lap.car}_track${lap.track}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) return null;

      fs.writeFileSync(filePath, pdfBuffer);
      return filePath;
    },
  );

  // ─── Setup: export PDF from raw data (used by mock lap in dev/test mode)
  ipcMain.handle(
    "setup:exportPdfFromData",
    async (
      _event,
      data: {
        lapNumber: number;
        lapTime: number;
        sector1: number | null;
        sector2: number | null;
        sector3: number | null;
        car: string;
        track: string;
        layout: string;
        recordedAt: string;
        analysisJson: string | null;
        setupJson: string | null;
      },
    ) => {
      const { dialog } = await import("electron");
      const fs = await import("fs");

      const analysis = data.analysisJson ? JSON.parse(data.analysisJson) : null;
      const setup = data.setupJson ? JSON.parse(data.setupJson) : null;

      const pdfData: PdfData = {
        car: data.car,
        track: data.track,
        layout: data.layout,
        lapNumber: data.lapNumber,
        lapTime: data.lapTime,
        sector1: data.sector1,
        sector2: data.sector2,
        sector3: data.sector3,
        condition: "Asciutto",
        sessionType: "Mock",
        recordedAt: data.recordedAt,
        templateV3: analysis?.templateV3 ?? null,
        setupParams: setup?.params ?? undefined,
      };

      const pdfBuffer = await generatePdfBuffer(pdfData);

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Salva analisi PDF (mock)",
        defaultPath: `giro${data.lapNumber}_${data.car.replace(/\s+/g, "_")}_mock.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) return null;

      fs.writeFileSync(filePath, pdfBuffer);
      return filePath;
    },
  );

  // ─── ACE Setup IPC
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
          return {
            filename,
            filePath,
            modifiedAt: stat.mtime.toISOString(),
          };
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
      // Extract carId from path: …/Car Setups/{car}/{track}/file.carsetup
      const parts = filePath.split(/[\\/]/);
      const carIdx = parts.findIndex((p) => p.toLowerCase() === "car setups");
      const carId =
        carIdx >= 0
          ? (parts[carIdx + 1] ?? "")
          : pathMod.basename(pathMod.dirname(pathMod.dirname(filePath)));
      return decodeCarSetup(buf, carId);
    },
  );

  // Start reader
  reader.start();

  pushStatus();

  // Re-push status once the renderer has finished loading its IPC listeners.
  // reader.start() is synchronous — the 'connected' event fires before the
  // renderer mounts useIPC, so the first pushStatus is lost. This ensures the
  // renderer receives the correct state after load.
  mainWindow?.webContents.once("did-finish-load", () => {
    pushStatus();
  });
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
  game = "r3e",
): number => {
  if (game === "ace") {
    const result = db
      .prepare(
        `INSERT INTO sessions_ace (car, track, layout, session_type, started_at)
         VALUES (?, ?, ?, 'practice', datetime('now'))`,
      )
      .run(car, track, layout);
    return result.lastInsertRowid as number;
  }
  const result = db
    .prepare(
      `INSERT INTO sessions (car, track, layout, session_type, game, started_at)
       VALUES (?, ?, ?, 'practice', ?, datetime('now'))`,
    )
    .run(car, track, layout, game);
  return result.lastInsertRowid as number;
};

const saveLap = (
  db: BetterSqlite3.Database,
  sessionId: number,
  lap: LapRecord,
  game = "r3e",
): void => {
  const lapsTable = game === "ace" ? "laps_ace" : "laps";
  const sessionsTable = game === "ace" ? "sessions_ace" : "sessions";
  try {
    const insertResult = db
      .prepare(
        `INSERT OR IGNORE INTO ${lapsTable}
         (session_id, lap_number, lap_time, sector1, sector2, sector3, valid, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        sessionId,
        lap.lapNumber,
        lap.lapTime,
        lap.sectorTimes[0] ?? null,
        lap.sectorTimes[1] ?? null,
        lap.sectorTimes[2] ?? null,
        lap.valid ? 1 : 0,
      );

    if (insertResult.changes === 0) {
      console.warn(
        `[Main] saveLap — INSERT OR IGNORE produced 0 changes (constraint violation?) ` +
          `session=${sessionId} lap=${lap.lapNumber} time=${lap.lapTime}`,
      );
    } else {
      console.log(
        `[Main] saveLap — OK session=${sessionId} lap=${lap.lapNumber} time=${lap.lapTime.toFixed(3)}s ` +
          `rowid=${insertResult.lastInsertRowid}`,
      );
    }

    const updateResult = db
      .prepare(
        `UPDATE ${sessionsTable} SET
           best_lap = CASE WHEN best_lap IS NULL OR ? < best_lap THEN ? ELSE best_lap END,
           lap_count = lap_count + 1
         WHERE id = ?`,
      )
      .run(lap.lapTime, lap.lapTime, sessionId);
    console.log(
      `[Main] saveLap — session update changes=${updateResult.changes}`,
    );
  } catch (err) {
    console.error("[Main] saveLap error:", err);
  }
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
