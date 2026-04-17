import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — exposes IPC channels to the renderer via contextBridge.
 * contextIsolation: true, nodeIntegration: false.
 * Must be compiled as CommonJS (.cts) because sandboxed preloads cannot use ESM.
 */

contextBridge.exposeInMainWorld('electronAPI', {
  // Main → Renderer (push channels)
  onFrame: (callback: (data: unknown) => void) => {
    ipcRenderer.on('r3e:frame', (_event, data) => callback(data));
  },
  onAlert: (callback: (data: unknown) => void) => {
    ipcRenderer.on('r3e:alert', (_event, data) => callback(data));
  },
  onLapComplete: (callback: (data: unknown) => void) => {
    ipcRenderer.on('r3e:lapComplete', (_event, data) => callback(data));
  },
  onStatus: (callback: (data: unknown) => void) => {
    ipcRenderer.on('r3e:status', (_event, data) => callback(data));
  },
  onAnalysis: (callback: (data: unknown) => void) => {
    ipcRenderer.on('r3e:analysis', (_event, data) => callback(data));
  },

  // Voice coach push channels (Main → Renderer)
  onVoiceChunk: (callback: (data: unknown) => void) => {
    ipcRenderer.on('coach:voiceChunk', (_event, data) => callback(data));
  },
  onVoiceDone: (callback: (data: unknown) => void) => {
    ipcRenderer.on('coach:voiceDone', (_event, data) => callback(data));
  },
  onVoiceAudio: (callback: (data: unknown) => void) => {
    ipcRenderer.on('coach:voiceAudio', (_event, data) => callback(data));
  },

  // Renderer → Main (request/response)
  getLaps: (params: { car: string; track: string }) =>
    ipcRenderer.invoke('db:getLaps', params),
  getAllLaps: () =>
    ipcRenderer.invoke('db:getAllLaps'),
  deleteLap: (params: { id: number; game: string }) =>
    ipcRenderer.invoke('db:deleteLap', params),
  deleteAllLaps: (items: Array<{ id: number; game: string }>) =>
    ipcRenderer.invoke('db:deleteAllLaps', items),
  getSession: (id: number, game: string) =>
    ipcRenderer.invoke('db:getSession', { id, game }),
  configGet: (key: string) =>
    ipcRenderer.invoke('config:get', key),
  configSet: (key: string, value: unknown) =>
    ipcRenderer.invoke('config:set', key, value),

  // Voice coach query
  voiceQuery: (question: string) =>
    ipcRenderer.invoke('coach:voiceQuery', question),

  // Azure STT
  sttTranscribe: (audioBuffer: ArrayBuffer, mimeType?: string): Promise<string> =>
    ipcRenderer.invoke('stt:transcribe', audioBuffer, mimeType),

  // Azure TTS
  ttsGetVoices: () =>
    ipcRenderer.invoke('tts:getVoices'),
  ttsSynthesize: (text: string) =>
    ipcRenderer.invoke('tts:synthesize', text),
  ttsTest: (voiceName: string) =>
    ipcRenderer.invoke('tts:test', voiceName),

  // Window controls
  windowClose: () => ipcRenderer.send('window:close'),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),

  // Cleanup
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Setup analysis
  listScreenshots: () =>
    ipcRenderer.invoke('setup:listScreenshots'),
  decodeSetup: (params: { filenames: string[]; expectedCar: string }) =>
    ipcRenderer.invoke('setup:decodeSetup', params),
  saveSetup: (params: { lapId: number; setup: unknown }) =>
    ipcRenderer.invoke('setup:saveSetup', params),
  exportPdf: (params: { lapId: number; game?: string }) =>
    ipcRenderer.invoke('setup:exportPdf', params),
  exportPdfFromData: (params: {
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
    game?: string;
  }) => ipcRenderer.invoke('setup:exportPdfFromData', params),

  // ACE setup (file-based)
  aceListSetupCars: () =>
    ipcRenderer.invoke('ace:listSetupCars'),
  aceListSetupTracks: (params: { car: string }) =>
    ipcRenderer.invoke('ace:listSetupTracks', params),
  aceListSetupFiles: (params: { car: string; track: string }) =>
    ipcRenderer.invoke('ace:listSetupFiles', params),
  aceReadSetup: (params: { filePath: string }) =>
    ipcRenderer.invoke('ace:readSetup', params),

  // Real-time session setup
  sessionSetSetup: (setup: unknown) =>
    ipcRenderer.invoke('session:setSetup', setup),
});
