import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload script — exposes IPC channels to the renderer via contextBridge.
 * contextIsolation: true, nodeIntegration: false.
 * Must be compiled as CommonJS (.cts) because sandboxed preloads cannot use ESM.
 */

contextBridge.exposeInMainWorld("electronAPI", {
  // Main → Renderer (push channels)
  onFrame: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:frame", listener);
    return () => ipcRenderer.removeListener("session:frame", listener);
  },
  onLapComplete: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("lapComplete", listener);
    return () => ipcRenderer.removeListener("lapComplete", listener);
  },
  onStatus: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("status", listener);
    return () => ipcRenderer.removeListener("status", listener);
  },

  // Global input trigger (Main → Renderer) — fires when keyboard shortcut or
  // gamepad button is pressed, regardless of window focus.
  onInputTrigger: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("input:trigger", listener);
    return () => ipcRenderer.removeListener("input:trigger", listener);
  },

  // Voice coach push channels (Main → Renderer)
  onVoiceChunk: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("coach:voiceChunk", listener);
    return () => ipcRenderer.removeListener("coach:voiceChunk", listener);
  },
  onVoiceDone: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("coach:voiceDone", listener);
    return () => ipcRenderer.removeListener("coach:voiceDone", listener);
  },
  onVoiceAudio: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("coach:voiceAudio", listener);
    return () => ipcRenderer.removeListener("coach:voiceAudio", listener);
  },

  // Session push channels
  onSessionStarted: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:started", listener);
    return () => ipcRenderer.removeListener("session:started", listener);
  },
  onSessionClosed: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:closed", listener);
    return () => ipcRenderer.removeListener("session:closed", listener);
  },
  onSessionLapAdded: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:lapAdded", listener);
    return () => ipcRenderer.removeListener("session:lapAdded", listener);
  },
  onSessionSetupLoaded: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:setupLoaded", listener);
    return () => ipcRenderer.removeListener("session:setupLoaded", listener);
  },
  onSessionAnalysisChunk: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:analysisChunk", listener);
    return () => ipcRenderer.removeListener("session:analysisChunk", listener);
  },
  onSessionAnalysisDone: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:analysisDone", listener);
    return () => ipcRenderer.removeListener("session:analysisDone", listener);
  },

  // Config
  configGet: (key: string) => ipcRenderer.invoke("config:get", key),
  configSet: (key: string, value: unknown) =>
    ipcRenderer.invoke("config:set", key, value),

  // Session lifecycle
  sessionStart: () => ipcRenderer.invoke("session:start"),
  sessionEnd: () => ipcRenderer.invoke("session:end"),
  sessionAnalyze: (params?: { sessionId?: number; game?: string; leaderboardMode?: boolean; fixedSetup?: boolean }) =>
    ipcRenderer.invoke("session:analyze", params ?? {}),
  sessionLoadSetup: (params: { setup: unknown; sessionId?: number; game?: string }) =>
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
  sessionReopen: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:reopen", params),
  sessionGetSetupHistory: (params: { car: string; track: string; layout: string; game: string }) =>
    ipcRenderer.invoke("session:getSetupHistory", params),
  sessionReuseSetup: (params: { setupId: number }) =>
    ipcRenderer.invoke("session:reuseSetup", params),
  sessionDeleteAnalysis: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:deleteAnalysis", params),

  // Lap telemetry frames (on demand)
  lapGetFrames: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("lap:getFrames", params),
  lapAssignSetup: (params: { lapId: number; setupId: number | null; game: string }) =>
    ipcRenderer.invoke("lap:assignSetup", params),
  lapDelete: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("lap:delete", params),

  // Track map geometry (cached per game/track/layout — global across cars)
  trackMapGet: (params: {
    game: string;
    track: string;
    layout: string;
  }) => ipcRenderer.invoke("trackMap:get", params),

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

  // Telemetry log
  telemetryLogGetDir: () => ipcRenderer.invoke("telemetry:getLogDir"),

  // ACE setup (file-based)
  aceListSetupCars: () => ipcRenderer.invoke("ace:listSetupCars"),
  aceListSetupTracks: (params: { car: string }) =>
    ipcRenderer.invoke("ace:listSetupTracks", params),
  aceListSetupFiles: (params: { car: string; track: string }) =>
    ipcRenderer.invoke("ace:listSetupFiles", params),
  aceReadSetup: (params: { filePath: string }) =>
    ipcRenderer.invoke("ace:readSetup", params),
});
