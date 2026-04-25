/**
 * App — Root component.
 * Layout: custom title bar (frameless Electron), main content area, bottom StatusBar.
 * TTSManager and VoiceCoachOverlay are headless/overlay — mounted globally.
 */

import { useEffect, useState } from "react";
import RealtimeAnalysis from "./components/RealtimeAnalysis";
import SessionHistory from "./components/SessionHistory";
import SettingsPanel from "./components/SettingsPanel";
import StatusBar from "./components/StatusBar";
import TitleBar from "./components/TitleBar";
import TTSManager from "./components/TTSManager";
import VoiceCoachOverlay from "./components/VoiceCoachOverlay";
import { useConfig, useIPC } from "./hooks/useIPC";
import { useVoiceCoach } from "./hooks/useVoiceCoach";
import { useIPCStore } from "./store/ipcStore";
import { subscribeSessionIPC } from "./store/sessionStore";
import { useSettingsStore } from "./store/settingsStore";

type Tab = "current-session" | "session-list" | "settings";

const App = () => {
  // Bootstrap IPC subscriptions (writes to ipcStore)
  useIPC();

  // Subscribe once to session:* push channels
  useEffect(() => {
    subscribeSessionIPC();
  }, []);

  // Read IPC state from store
  const status = useIPCStore((s) => s.status);

  // Settings state from Zustand store
  const {
    assistantName,
    setAssistantName,
    gamepadButton,
    setGamepadButton,
    ttsEnabled,
    azureTtsEnabled,
    setAzureTtsEnabled,
    setApiKey,
    setAnthropicModel,
    setAzureSpeechKey,
    setAzureRegion,
    setAzureVoiceName,
  } = useSettingsStore();

  const { get: configGet } = useConfig();
  const [tab, setTab] = useState<Tab>("current-session");
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Voice coach hook
  const {
    state: voiceState,
    transcript,
    answer,
  } = useVoiceCoach({
    triggerButtonIndex: gamepadButton,
    enabled: ttsEnabled,
    azureTtsEnabled,
  });

  // Load all settings from config on mount
  useEffect(() => {
    const load = async () => {
      const [ak, az, key, region, voice, name, button, model] =
        await Promise.all([
          configGet("anthropicApiKey"),
          configGet("azureTtsEnabled"),
          configGet("azureSpeechKey"),
          configGet("azureRegion"),
          configGet("azureVoiceName"),
          configGet("assistantName"),
          configGet("gamepadTriggerButton"),
          configGet("anthropicModel"),
        ]);
      if (ak) setApiKey(ak);
      if (az) setAzureTtsEnabled(az === "true");
      if (key) setAzureSpeechKey(key);
      if (region) setAzureRegion(region);
      if (voice) setAzureVoiceName(voice);
      if (name) setAssistantName(name);
      if (button) setGamepadButton(Number(button));
      if (model) setAnthropicModel(model);
      setSettingsLoaded(true);
    };
    load().catch(console.error);
  }, [
    configGet,
    setApiKey,
    setAzureTtsEnabled,
    setAzureSpeechKey,
    setAzureRegion,
    setAzureVoiceName,
    setAssistantName,
    setGamepadButton,
    setAnthropicModel,
  ]);

  return (
    <div className="app">
      {/* Headless TTS */}
      <TTSManager
        postLapText={null}
        enabled={ttsEnabled}
        azureEnabled={azureTtsEnabled}
        assistantName={assistantName}
        settingsLoaded={settingsLoaded}
      />

      {/* Voice coach overlay */}
      <VoiceCoachOverlay
        state={voiceState}
        transcript={transcript}
        answer={answer}
      />

      {/* Title bar (frameless Electron drag area) */}
      <TitleBar tab={tab} onTabChange={setTab} />

      {/* Main content */}
      <div className="main-content">
        {tab === "current-session" && <RealtimeAnalysis />}
        {tab === "session-list" && <SessionHistory />}
        {tab === "settings" && <SettingsPanel />}
      </div>

      {/* Status bar */}
      <StatusBar status={status} />
    </div>
  );
};

export default App;
