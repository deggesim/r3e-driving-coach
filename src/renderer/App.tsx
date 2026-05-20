/**
 * App — Root component.
 * Layout: custom title bar (frameless Electron), main content area, bottom StatusBar.
 * TTSManager and VoiceCoachOverlay are headless/overlay — mounted globally.
 */

import { Suspense, use, useEffect, useState } from "react";
import { Alert } from "react-bootstrap";
import RealtimeAnalysis from "./components/RealtimeAnalysis";
import SessionHistory from "./components/SessionHistory";
import SettingsPanel from "./components/SettingsPanel";
import StatusBar from "./components/StatusBar";
import TitleBar from "./components/TitleBar";
import TTSManager from "./components/TTSManager";
import VoiceCoachOverlay from "./components/VoiceCoachOverlay";
import { useIPC } from "./hooks/useIPC";
import { useVoiceCoach } from "./hooks/useVoiceCoach";
import { useIPCStore } from "./store/ipcStore";
import { subscribeSessionIPC } from "./store/sessionStore";
import { useSettingsStore } from "./store/settingsStore";
import { settingsLoaderPromise } from "./loaders/settingsLoader";

type Tab = "current-session" | "session-list" | "settings";

const App = () => {
  // Bootstrap IPC subscriptions (writes to ipcStore)
  useIPC();

  // Subscribe once to session:* push channels
  useEffect(() => {
    subscribeSessionIPC();
  }, []);

  // Suspend until all settings are loaded from SQLite via IPC.
  // settingsLoaderPromise is a stable module-level Promise — safe to pass to use().
  // The parent <Suspense> boundary in main.tsx handles the loading state.
  use(settingsLoaderPromise);

  // Read IPC state from store
  const status = useIPCStore((s) => s.status);

  // Settings state from Zustand store (populated by settingsLoaderPromise above)
  const {
    assistantName,
    gamepadButton,
    capturingVoiceInput,
    ttsEnabled,
    azureTtsEnabled,
    settingsLoaded,
  } = useSettingsStore();

  const [tab, setTab] = useState<Tab>("current-session");
  const [appError, setAppError] = useState<string | null>(null);

  useEffect(() => {
    return window.electronAPI.onAppError(({ message }) => setAppError(message));
  }, []);

  // Voice coach hook
  const {
    state: voiceState,
    transcript,
    answer,
  } = useVoiceCoach({
    triggerButtonIndex: gamepadButton,
    enabled: ttsEnabled && !capturingVoiceInput,
    azureTtsEnabled,
  });

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

      {/* Global error alert — credit/quota errors from Azure TTS or Claude API */}
      {appError && (
        <Alert
          variant="danger"
          onClose={() => setAppError(null)}
          dismissible
          className="mb-0 rounded-0 border-start-0 border-end-0"
          style={{ zIndex: 1000 }}
        >
          {appError}
        </Alert>
      )}

      {/* Main content */}
      <div className="main-content">
        {tab === "current-session" && (
          <Suspense fallback={<div className="flex-grow-1" />}>
            <RealtimeAnalysis onSessionClosed={() => setTab("session-list")} />
          </Suspense>
        )}
        {tab === "session-list" && (
          <SessionHistory onSwitchToLive={() => setTab("current-session")} />
        )}
        {tab === "settings" && <SettingsPanel />}
      </div>

      {/* Status bar */}
      <StatusBar status={status} />
    </div>
  );
};

export default App;
