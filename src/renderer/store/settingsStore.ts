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

  // ACE
  aceSetupsPath: string;

  // Loaded flag — true after initFromConfig resolves
  settingsLoaded: boolean;

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
  setAceSetupsPath: (v: string) => void;
  showSaved: (key: string) => void;
  clearSaved: () => void;

  /**
   * Bulk-apply all persisted config values loaded from SQLite at startup.
   * Called once by the module-level settings loader promise; not from component render.
   */
  initFromConfig: (values: {
    apiKey: string | null;
    azureTtsEnabled: string | null;
    azureSpeechKey: string | null;
    azureRegion: string | null;
    azureVoiceName: string | null;
    assistantName: string | null;
    gamepadButton: string | null;
    anthropicModel: string | null;
    telemetryLogEnabled: string | null;
    keyboardVoiceKey: string | null;
    aceSetupsPath: string | null;
  }) => void;
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
  aceSetupsPath: "",
  settingsLoaded: false,

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
  setAceSetupsPath: (aceSetupsPath) => set({ aceSetupsPath }),
  showSaved: (key) => {
    set({ settingSaved: key });
    setTimeout(() => set({ settingSaved: null }), 2000);
  },
  clearSaved: () => set({ settingSaved: null }),

  initFromConfig: (values) => {
    set({
      ...(values.apiKey ? { apiKey: values.apiKey } : {}),
      ...(values.azureTtsEnabled
        ? { azureTtsEnabled: values.azureTtsEnabled === "true" }
        : {}),
      ...(values.azureSpeechKey
        ? { azureSpeechKey: values.azureSpeechKey }
        : {}),
      ...(values.azureRegion ? { azureRegion: values.azureRegion } : {}),
      ...(values.azureVoiceName
        ? { azureVoiceName: values.azureVoiceName }
        : {}),
      ...(values.assistantName ? { assistantName: values.assistantName } : {}),
      gamepadButton: values.gamepadButton ? Number(values.gamepadButton) : null,
      ...(values.anthropicModel
        ? { anthropicModel: values.anthropicModel }
        : {}),
      ...(values.telemetryLogEnabled
        ? { telemetryLogEnabled: values.telemetryLogEnabled === "true" }
        : {}),
      keyboardVoiceKey: values.keyboardVoiceKey ?? null,
      ...(values.aceSetupsPath ? { aceSetupsPath: values.aceSetupsPath } : {}),
      settingsLoaded: true,
    });
  },
}));
