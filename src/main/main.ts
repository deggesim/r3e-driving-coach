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

  seedCornerNames(
    db,
    cornerNamesData as Record<
      string,
      Array<{ distMin: number; distMax: number; name: string }>
    >,
  );

  let currentCar = "";
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

  const pushStatus = (): void => {
    const status: R3EStatus = {
      connected: reader !== null,
      calibrating: recorder.isCalibrating(),
      lapsToCalibration: recorder.lapsToCalibration(),
      car: currentCar || null,
      track: currentTrack || null,
      layout: currentLayout || null,
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

  // ─── Reader
  reader = createR3EReader();

  reader.on("connected", () => {
    pushStatus();
  });

  reader.on("disconnected", () => {
    pushStatus();
  });

  reader.on("frame", (frame: R3EFrame) => {
    if (frame.carName) currentCar = frame.carName;
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
      console.log("lap", lap);

      pushToRenderer("r3e:lapComplete", lap);
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

      if (!calibrating && lap.valid) {
        const apiKeyRow = db
          .prepare("SELECT value FROM app_config WHERE key = ?")
          .get("anthropicApiKey") as { value: string } | undefined;
        const apiKey = apiKeyRow?.value;
        console.log("apiKey", apiKey);
        if (apiKey) coachEngine.updateApiKey(apiKey);
        coachEngine.analyzeLap(lap, deviations).catch((err) => {
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
      console.log(`[STT IPC] Received ${buf.byteLength} bytes, mimeType=${mimeType ?? "(default)"}`);
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
    async (_event, { filenames, expectedCar }: { filenames: string[]; expectedCar: string }) => {
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
          source: { type: "base64" as const, media_type: "image/jpeg" as const, data },
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
    (_event, { lapId, setup }: { lapId: number; setup: { carVerified: boolean; carFound: string; setupText: string; params: unknown[]; screenshots: string[] } }) => {
      db.prepare(
        "UPDATE laps SET setup_json = ?, setup_screenshots = ? WHERE id = ?",
      ).run(
        JSON.stringify({ carVerified: setup.carVerified, carFound: setup.carFound, setupText: setup.setupText, params: setup.params }),
        JSON.stringify(setup.screenshots),
        lapId,
      );
    },
  );

  // ─── Setup: export PDF with analysis + setup using branded template
  ipcMain.handle("setup:exportPdf", async (_event, { lapId }: { lapId: number }) => {
    const { dialog } = await import("electron");
    const fs = await import("fs");

    const lap = db
      .prepare(
        `SELECT l.*, s.car, s.track, s.layout
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
          recorded_at: string;
        }
      | undefined;

    if (!lap) return null;

    const analysis = lap.analysis_json ? JSON.parse(lap.analysis_json) : null;
    const setup = lap.setup_json ? JSON.parse(lap.setup_json) : null;

    const { jsPDF } = await import("jspdf");

    const fmtTime = (s: number | null): string => {
      if (!s || s <= 0) return "--:--";
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return m > 0 ? `${m}:${sec.toFixed(3).padStart(6, "0")}` : `${sec.toFixed(3)}s`;
    };

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const ml = 15;
    const mr = 15;
    const cw = W - ml - mr;
    let y = 0;

    const checkPage = (needed = 10): void => {
      if (y + needed > H - 15) {
        doc.addPage();
        y = 15;
      }
    };

    // ── Header block
    doc.setFillColor(15, 15, 15);
    doc.rect(0, 0, W, 30, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(232, 69, 26); // accent orange
    doc.text(`${lap.car}`, ml, 12);
    doc.setFontSize(10);
    doc.setTextColor(200, 200, 200);
    doc.text(`${lap.track} ${lap.layout} | Giro ${lap.lap_number}: ${fmtTime(lap.lap_time)}`, ml, 19);
    const sessionDate = new Date(lap.recorded_at).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
    const cond = "Asciutto";
    doc.text(`${sessionDate} | ${cond}`, ml, 25);
    y = 38;

    // Sector row
    doc.setFillColor(36, 36, 36);
    doc.rect(0, 30, W, 10, "F");
    doc.setFontSize(9);
    doc.setTextColor(136, 136, 136);
    const sectors = `S1: ${fmtTime(lap.sector1)}   S2: ${fmtTime(lap.sector2)}   S3: ${fmtTime(lap.sector3)}`;
    doc.text(sectors, ml, 36);
    doc.setTextColor(232, 69, 26);
    doc.text(`Tempo: ${fmtTime(lap.lap_time)}`, W - mr - 40, 36);
    y = 46;

    const drawSectionHeader = (title: string): void => {
      checkPage(12);
      doc.setFillColor(36, 36, 36);
      doc.rect(ml - 2, y - 4, cw + 4, 8, "F");
      doc.setDrawColor(232, 69, 26);
      doc.setLineWidth(0.5);
      doc.line(ml - 2, y - 4, ml - 2, y + 4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(232, 69, 26);
      doc.text(title, ml + 2, y + 0.5);
      y += 7;
      doc.setTextColor(220, 220, 220);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
    };

    // ── Section [1–5] from analysis markdown
    if (analysis?.templateV3) {
      const sections = analysis.templateV3.split(/(?=\[(\d)\])/);
      for (const sect of sections) {
        const headerMatch = sect.match(/^\[(\d)\]\s*([^\n]*)/);
        if (headerMatch) {
          drawSectionHeader(`[${headerMatch[1]}] ${headerMatch[2]}`);
          const body = sect.replace(/^\[(\d)\][^\n]*\n?/, "").trim();
          const lines = doc.splitTextToSize(body, cw);
          for (const line of lines) {
            checkPage(5);
            const isBullet = line.trimStart().startsWith("•") || line.trimStart().startsWith("-") || line.trimStart().startsWith("*");
            doc.setFont("helvetica", isBullet ? "normal" : "normal");
            doc.setTextColor(200, 200, 200);
            doc.setFontSize(8.5);
            doc.text(line, ml, y);
            y += 4.5;
          }
          y += 3;
        }
      }
    }

    // ── Setup section
    if (setup?.params?.length) {
      checkPage(14);
      drawSectionHeader("Setup Auto");

      // Table header
      doc.setFillColor(50, 50, 50);
      doc.rect(ml, y - 3, cw, 7, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(180, 180, 180);
      const colW = [40, 80, cw - 120];
      doc.text("Categoria", ml + 2, y + 1);
      doc.text("Parametro", ml + colW[0] + 2, y + 1);
      doc.text("Valore", ml + colW[0] + colW[1] + 2, y + 1);
      y += 7;

      let rowAlt = false;
      for (const p of setup.params as Array<{ category: string; parameter: string; value: string }>) {
        checkPage(6);
        if (rowAlt) {
          doc.setFillColor(28, 28, 28);
          doc.rect(ml, y - 3, cw, 5.5, "F");
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(190, 190, 190);
        doc.text(String(p.category ?? ""), ml + 2, y + 0.5, { maxWidth: colW[0] - 4 });
        doc.text(String(p.parameter ?? ""), ml + colW[0] + 2, y + 0.5, { maxWidth: colW[1] - 4 });
        doc.setTextColor(232, 200, 26);
        doc.text(String(p.value ?? ""), ml + colW[0] + colW[1] + 2, y + 0.5, { maxWidth: colW[2] - 4 });
        y += 5.5;
        rowAlt = !rowAlt;
      }
      y += 4;
    }

    // ── Footer
    const totalPages = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setDrawColor(46, 46, 46);
      doc.setLineWidth(0.3);
      doc.line(ml, H - 10, W - mr, H - 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(
        "Analisi generata da R3E Driving Coach • Simulatore: RaceRoom Racing Experience • Telemetria: Second Monitor",
        ml,
        H - 6,
      );
      doc.text(`${i} / ${totalPages}`, W - mr, H - 6, { align: "right" });
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Salva analisi PDF",
      defaultPath: `giro${lap.lap_number}_${lap.car.replace(/\s+/g, "_")}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (canceled || !filePath) return null;

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    fs.writeFileSync(filePath, pdfBuffer);
    return filePath;
  });

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
      const { jsPDF } = await import("jspdf");

      const analysis = data.analysisJson ? JSON.parse(data.analysisJson) : null;
      const setup = data.setupJson ? JSON.parse(data.setupJson) : null;

      const fmtTime = (s: number | null): string => {
        if (!s || s <= 0) return "--:--";
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m > 0 ? `${m}:${sec.toFixed(3).padStart(6, "0")}` : `${sec.toFixed(3)}s`;
      };

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const ml = 15;
      const mr = 15;
      const cw = W - ml - mr;
      let y = 0;

      const checkPage = (needed = 10): void => {
        if (y + needed > H - 15) {
          doc.addPage();
          y = 15;
        }
      };

      // Header
      doc.setFillColor(15, 15, 15);
      doc.rect(0, 0, W, 30, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(232, 69, 26);
      doc.text(`${data.car}`, ml, 12);
      doc.setFontSize(10);
      doc.setTextColor(200, 200, 200);
      doc.text(`${data.track}${data.layout ? " " + data.layout : ""} | Giro ${data.lapNumber}: ${fmtTime(data.lapTime)}`, ml, 19);
      const sessionDate = new Date(data.recordedAt).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
      doc.text(`${sessionDate} | Mock`, ml, 25);
      y = 38;

      // Sector row
      doc.setFillColor(36, 36, 36);
      doc.rect(0, 30, W, 10, "F");
      doc.setFontSize(9);
      doc.setTextColor(136, 136, 136);
      const sectors = `S1: ${fmtTime(data.sector1)}   S2: ${fmtTime(data.sector2)}   S3: ${fmtTime(data.sector3)}`;
      doc.text(sectors, ml, 36);
      doc.setTextColor(232, 69, 26);
      doc.text(`Tempo: ${fmtTime(data.lapTime)}`, W - mr - 40, 36);
      y = 46;

      const drawSectionHeader = (title: string): void => {
        checkPage(12);
        doc.setFillColor(36, 36, 36);
        doc.rect(ml - 2, y - 4, cw + 4, 8, "F");
        doc.setDrawColor(232, 69, 26);
        doc.setLineWidth(0.5);
        doc.line(ml - 2, y - 4, ml - 2, y + 4);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(232, 69, 26);
        doc.text(title, ml + 2, y + 0.5);
        y += 7;
        doc.setTextColor(220, 220, 220);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
      };

      if (analysis?.templateV3) {
        const sections = analysis.templateV3.split(/(?=\[(\d)\])/);
        for (const sect of sections) {
          const headerMatch = sect.match(/^\[(\d)\]\s*([^\n]*)/);
          if (headerMatch) {
            drawSectionHeader(`[${headerMatch[1]}] ${headerMatch[2]}`);
            const body = sect.replace(/^\[(\d)\][^\n]*\n?/, "").trim();
            const lines = doc.splitTextToSize(body, cw);
            for (const line of lines) {
              checkPage(5);
              doc.setFont("helvetica", "normal");
              doc.setTextColor(200, 200, 200);
              doc.setFontSize(8.5);
              doc.text(line, ml, y);
              y += 4.5;
            }
            y += 3;
          }
        }
      }

      if (setup?.params?.length) {
        checkPage(14);
        drawSectionHeader("Setup Auto");
        doc.setFillColor(50, 50, 50);
        doc.rect(ml, y - 3, cw, 7, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(180, 180, 180);
        const colW = [40, 80, cw - 120];
        doc.text("Categoria", ml + 2, y + 1);
        doc.text("Parametro", ml + colW[0] + 2, y + 1);
        doc.text("Valore", ml + colW[0] + colW[1] + 2, y + 1);
        y += 7;
        let rowAlt = false;
        for (const p of setup.params as Array<{ category: string; parameter: string; value: string }>) {
          checkPage(6);
          if (rowAlt) {
            doc.setFillColor(28, 28, 28);
            doc.rect(ml, y - 3, cw, 5.5, "F");
          }
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(190, 190, 190);
          doc.text(String(p.category ?? ""), ml + 2, y + 0.5, { maxWidth: colW[0] - 4 });
          doc.text(String(p.parameter ?? ""), ml + colW[0] + 2, y + 0.5, { maxWidth: colW[1] - 4 });
          doc.setTextColor(232, 200, 26);
          doc.text(String(p.value ?? ""), ml + colW[0] + colW[1] + 2, y + 0.5, { maxWidth: colW[2] - 4 });
          y += 5.5;
          rowAlt = !rowAlt;
        }
        y += 4;
      }

      // Footer
      const totalPages = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(46, 46, 46);
        doc.setLineWidth(0.3);
        doc.line(ml, H - 10, W - mr, H - 10);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(100, 100, 100);
        doc.text(
          "Analisi generata da R3E Driving Coach • Simulatore: RaceRoom Racing Experience • Telemetria: Second Monitor",
          ml,
          H - 6,
        );
        doc.text(`${i} / ${totalPages}`, W - mr, H - 6, { align: "right" });
      }

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Salva analisi PDF (mock)",
        defaultPath: `giro${data.lapNumber}_${data.car.replace(/\s+/g, "_")}_mock.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) return null;

      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      fs.writeFileSync(filePath, pdfBuffer);
      return filePath;
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
