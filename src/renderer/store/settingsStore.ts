/**
 * settingsStore — Zustand store for user settings (loaded from SQLite via IPC).
 * Centralises all settings state that was previously scattered across App.tsx useState calls.
 */

import { create } from "zustand";

type SettingsStore = {
  // General / AI
  apiKey: string;
  assistantName: string;
  gamepadButton: number;

  // TTS
  ttsEnabled: boolean;
  azureTtsEnabled: boolean;
  azureSpeechKey: string;
  azureRegion: string;
  azureVoiceName: string;

  // UI state
  settingSaved: string | null;

  // Dev / test
  mockHistoryMode: boolean;

  // Setters
  setApiKey: (v: string) => void;
  setAssistantName: (v: string) => void;
  setGamepadButton: (v: number) => void;
  setTtsEnabled: (v: boolean) => void;
  setAzureTtsEnabled: (v: boolean) => void;
  setAzureSpeechKey: (v: string) => void;
  setAzureRegion: (v: string) => void;
  setAzureVoiceName: (v: string) => void;
  setMockHistoryMode: (v: boolean) => void;
  showSaved: (key: string) => void;
  clearSaved: () => void;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  apiKey: "",
  assistantName: "Aria",
  gamepadButton: 0,
  ttsEnabled: true,
  azureTtsEnabled: false,
  azureSpeechKey: "",
  azureRegion: "westeurope",
  azureVoiceName: "",
  settingSaved: null,
  mockHistoryMode: false,

  setApiKey: (apiKey) => set({ apiKey }),
  setAssistantName: (assistantName) => set({ assistantName }),
  setGamepadButton: (gamepadButton) => set({ gamepadButton }),
  setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),
  setAzureTtsEnabled: (azureTtsEnabled) => set({ azureTtsEnabled }),
  setAzureSpeechKey: (azureSpeechKey) => set({ azureSpeechKey }),
  setAzureRegion: (azureRegion) => set({ azureRegion }),
  setAzureVoiceName: (azureVoiceName) => set({ azureVoiceName }),
  setMockHistoryMode: (mockHistoryMode) => set({ mockHistoryMode }),
  showSaved: (key) => {
    set({ settingSaved: key });
    setTimeout(() => set({ settingSaved: null }), 2000);
  },
  clearSaved: () => set({ settingSaved: null }),
}));
