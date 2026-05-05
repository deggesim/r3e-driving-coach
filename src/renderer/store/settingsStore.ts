/**
 * settingsStore — Zustand store for user settings (loaded from SQLite via IPC).
 * Centralises all settings state that was previously scattered across App.tsx useState calls.
 */

import { create } from "zustand";

type SettingsStore = {
  // General / AI
  apiKey: string;
  assistantName: string;
  gamepadButton: number | null;
  anthropicModel: string;
  keyboardVoiceKey: string | null;

  // TTS
  ttsEnabled: boolean;
  azureTtsEnabled: boolean;
  azureSpeechKey: string;
  azureRegion: string;
  azureVoiceName: string;

  // UI state
  settingSaved: string | null;
  capturingVoiceInput: boolean;

  // Dev / test
  mockHistoryMode: boolean;
  telemetryLogEnabled: boolean;

  // Setters
  setApiKey: (v: string) => void;
  setAssistantName: (v: string) => void;
  setGamepadButton: (v: number | null) => void;
  setAnthropicModel: (v: string) => void;
  setKeyboardVoiceKey: (v: string | null) => void;
  setTtsEnabled: (v: boolean) => void;
  setAzureTtsEnabled: (v: boolean) => void;
  setAzureSpeechKey: (v: string) => void;
  setAzureRegion: (v: string) => void;
  setAzureVoiceName: (v: string) => void;
  setMockHistoryMode: (v: boolean) => void;
  setTelemetryLogEnabled: (v: boolean) => void;
  setCapturingVoiceInput: (v: boolean) => void;
  showSaved: (key: string) => void;
  clearSaved: () => void;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  apiKey: "",
  assistantName: "Aria",
  gamepadButton: null,
  anthropicModel: "claude-haiku-4-5-20251001",
  keyboardVoiceKey: null,
  ttsEnabled: true,
  azureTtsEnabled: false,
  azureSpeechKey: "",
  azureRegion: "westeurope",
  azureVoiceName: "",
  settingSaved: null,
  capturingVoiceInput: false,
  mockHistoryMode: false,
  telemetryLogEnabled: false,

  setApiKey: (apiKey) => set({ apiKey }),
  setAssistantName: (assistantName) => set({ assistantName }),
  setGamepadButton: (gamepadButton) => set({ gamepadButton }),
  setAnthropicModel: (anthropicModel) => set({ anthropicModel }),
  setKeyboardVoiceKey: (keyboardVoiceKey) => set({ keyboardVoiceKey }),
  setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),
  setAzureTtsEnabled: (azureTtsEnabled) => set({ azureTtsEnabled }),
  setAzureSpeechKey: (azureSpeechKey) => set({ azureSpeechKey }),
  setAzureRegion: (azureRegion) => set({ azureRegion }),
  setAzureVoiceName: (azureVoiceName) => set({ azureVoiceName }),
  setCapturingVoiceInput: (capturingVoiceInput) => set({ capturingVoiceInput }),
  setMockHistoryMode: (mockHistoryMode) => set({ mockHistoryMode }),
  setTelemetryLogEnabled: (telemetryLogEnabled) => set({ telemetryLogEnabled }),
  showSaved: (key) => {
    set({ settingSaved: key });
    setTimeout(() => set({ settingSaved: null }), 2000);
  },
  clearSaved: () => set({ settingSaved: null }),
}));
