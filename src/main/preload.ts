import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — exposes IPC channels to the renderer via contextBridge.
 * contextIsolation: true, nodeIntegration: false.
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

  // Renderer → Main (request/response)
  getLaps: (params: { car: string; track: string }) =>
    ipcRenderer.invoke('db:getLaps', params),
  getSession: (id: number) =>
    ipcRenderer.invoke('db:getSession', id),
  configGet: (key: string) =>
    ipcRenderer.invoke('config:get', key),
  configSet: (key: string, value: unknown) =>
    ipcRenderer.invoke('config:set', key, value),

  // Cleanup
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
