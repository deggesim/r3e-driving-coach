import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload script — exposes IPC channels to the renderer via contextBridge.
 * contextIsolation: true, nodeIntegration: false.
 * Must be compiled as CommonJS (.cts) because sandboxed preloads cannot use ESM.
 */

contextBridge.exposeInMainWorld("electronAPI", {
  // Main → Renderer (push channels)
  onFrame: (callback: (data: unknown) => void) => {
    ipcRenderer.on("session:frame", (_event, data) => callback(data));
  },
  onLapComplete: (callback: (data: unknown) => void) => {
    ipcRenderer.on("lapComplete", (_event, data) => callback(data));
  },
  onStatus: (callback: (data: unknown) => void) => {
    ipcRenderer.on("status", (_event, data) => callback(data));
  },

  // Voice coach push channels (Main → Renderer)
  onVoiceChunk: (callback: (data: unknown) => void) => {
    ipcRenderer.on("coach:voiceChunk", (_event, data) => callback(data));
  },
  onVoiceDone: (callback: (data: unknown) => void) => {
    ipcRenderer.on("coach:voiceDone", (_event, data) => callback(data));
  },
  onVoiceAudio: (callback: (data: unknown) => void) => {
    ipcRenderer.on("coach:voiceAudio", (_event, data) => callback(data));
  },

  // Session push channels
  onSessionStarted: (callback: (data: unknown) => void) => {
    ipcRenderer.on("session:started", (_event, data) => callback(data));
  },
  onSessionClosed: (callback: (data: unknown) => void) => {
    ipcRenderer.on("session:closed", (_event, data) => callback(data));
  },
  onSessionLapAdded: (callback: (data: unknown) => void) => {
    ipcRenderer.on("session:lapAdded", (_event, data) => callback(data));
  },
  onSessionSetupLoaded: (callback: (data: unknown) => void) => {
    ipcRenderer.on("session:setupLoaded", (_event, data) => callback(data));
  },
  onSessionAnalysisChunk: (callback: (data: unknown) => void) => {
    ipcRenderer.on("session:analysisChunk", (_event, data) => callback(data));
  },
  onSessionAnalysisDone: (callback: (data: unknown) => void) => {
    ipcRenderer.on("session:analysisDone", (_event, data) => callback(data));
  },

  // Config
  configGet: (key: string) => ipcRenderer.invoke("config:get", key),
  configSet: (key: string, value: unknown) =>
    ipcRenderer.invoke("config:set", key, value),

  // Session lifecycle
  sessionStart: () => ipcRenderer.invoke("session:start"),
  sessionEnd: () => ipcRenderer.invoke("session:end"),
  sessionAnalyze: (params?: { sessionId?: number; game?: string }) =>
    ipcRenderer.invoke("session:analyze", params ?? {}),
  sessionLoadSetup: (params: { setup: unknown }) =>
    ipcRenderer.invoke("session:loadSetup", params),
  sessionList: (params: unknown) => ipcRenderer.invoke("session:list", params),
  sessionGetCurrent: () => ipcRenderer.invoke("session:getCurrent"),
  sessionGetDetail: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:getDetail", params),
  sessionExportPdf: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:exportPdf", params),
  sessionDelete: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:delete", params),
  sessionDeleteAll: (items: Array<{ id: number; game: string }>) =>
    ipcRenderer.invoke("session:deleteAll", items),

  // Lap telemetry frames (on demand)
  lapGetFrames: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("lap:getFrames", params),

  // Voice coach query
  voiceQuery: (question: string) =>
    ipcRenderer.invoke("coach:voiceQuery", question),

  // Azure STT
  sttTranscribe: (
    audioBuffer: ArrayBuffer,
    mimeType?: string,
  ): Promise<string> =>
    ipcRenderer.invoke("stt:transcribe", audioBuffer, mimeType),

  // Azure TTS
  ttsGetVoices: () => ipcRenderer.invoke("tts:getVoices"),
  ttsSynthesize: (text: string) => ipcRenderer.invoke("tts:synthesize", text),
  ttsTest: (voiceName: string) => ipcRenderer.invoke("tts:test", voiceName),

  // Window controls
  windowClose: () => ipcRenderer.send("window:close"),
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowMaximize: () => ipcRenderer.send("window:maximize"),

  // Cleanup
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Setup analysis (used to produce SetupData, then passed to sessionLoadSetup)
  listScreenshots: () => ipcRenderer.invoke("setup:listScreenshots"),
  decodeSetup: (params: { filenames: string[]; expectedCar: string }) =>
    ipcRenderer.invoke("setup:decodeSetup", params),

  // ACE setup (file-based)
  aceListSetupCars: () => ipcRenderer.invoke("ace:listSetupCars"),
  aceListSetupTracks: (params: { car: string }) =>
    ipcRenderer.invoke("ace:listSetupTracks", params),
  aceListSetupFiles: (params: { car: string; track: string }) =>
    ipcRenderer.invoke("ace:listSetupFiles", params),
  aceReadSetup: (params: { filePath: string }) =>
    ipcRenderer.invoke("ace:readSetup", params),
});
