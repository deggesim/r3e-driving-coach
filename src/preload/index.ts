import { contextBridge, ipcRenderer } from "electron";
// Output forced to CJS by electron.vite.config.ts (preload requires CJS with sandbox:true)

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

  onAppError: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("app:error", listener);
    return () => ipcRenderer.removeListener("app:error", listener);
  },

  onInputTrigger: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("input:trigger", listener);
    return () => ipcRenderer.removeListener("input:trigger", listener);
  },

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

  configGet: (key: string) => ipcRenderer.invoke("config:get", key),
  configSet: (key: string, value: unknown) =>
    ipcRenderer.invoke("config:set", key, value),

  sessionStart: () => ipcRenderer.invoke("session:start"),
  sessionEnd: () => ipcRenderer.invoke("session:end"),
  sessionUpdateFlags: (params: { sessionId?: number; game?: string; leaderboardMode: boolean; fixedSetup: boolean }) =>
    ipcRenderer.invoke("session:updateFlags", params),
  sessionAnalyze: (params?: { sessionId?: number; game?: string }) =>
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

  lapGetFrames: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("lap:getFrames", params),
  lapAssignSetup: (params: { lapId: number; setupId: number | null; game: string }) =>
    ipcRenderer.invoke("lap:assignSetup", params),
  lapDelete: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("lap:delete", params),

  trackMapGet: (params: { game: string; track: string; layout: string }) =>
    ipcRenderer.invoke("trackMap:get", params),

  voiceQuery: (question: string) =>
    ipcRenderer.invoke("coach:voiceQuery", question),

  sttTranscribe: (audioBuffer: ArrayBuffer, mimeType?: string): Promise<string> =>
    ipcRenderer.invoke("stt:transcribe", audioBuffer, mimeType),

  ttsGetVoices: () => ipcRenderer.invoke("tts:getVoices"),
  ttsSynthesize: (text: string) => ipcRenderer.invoke("tts:synthesize", text),
  ttsTest: (voiceName: string) => ipcRenderer.invoke("tts:test", voiceName),

  windowClose: () => ipcRenderer.send("window:close"),
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowMaximize: () => ipcRenderer.send("window:maximize"),

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  telemetryLogGetDir: () => ipcRenderer.invoke("telemetry:getLogDir"),

  aceListSetupCars: () => ipcRenderer.invoke("ace:listSetupCars"),
  aceListSetupTracks: (params: { car: string }) =>
    ipcRenderer.invoke("ace:listSetupTracks", params),
  aceListSetupFiles: (params: { car: string; track: string }) =>
    ipcRenderer.invoke("ace:listSetupFiles", params),
  aceReadSetup: (params: { filePath: string }) =>
    ipcRenderer.invoke("ace:readSetup", params),
});
