/**
 * App — Root component.
 * Layout: custom title bar (frameless Electron), main content area, bottom StatusBar.
 * TTSManager and VoiceCoachOverlay are headless/overlay — mounted globally.
 */

import { useEffect, useState } from "react";
import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faMicrophoneSlash,
  faMinus,
  faExpand,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useIPC, useConfig } from "./hooks/useIPC";
import { useIPCStore } from "./store/ipcStore";
import { useSettingsStore } from "./store/settingsStore";
import { subscribeSessionIPC } from "./store/sessionStore";
import { useVoiceCoach } from "./hooks/useVoiceCoach";
import iconUrl from "/icon.png";
import TTSManager from "./components/TTSManager";
import StatusBar from "./components/StatusBar";
import RealtimeAnalysis from "./components/RealtimeAnalysis";
import SessionHistory from "./components/SessionHistory";
import VoiceCoachOverlay from "./components/VoiceCoachOverlay";
import SettingsPanel from "./components/SettingsPanel";

type Tab = "debriefing" | "history" | "settings";

const App = () => {
  // Bootstrap IPC subscriptions (writes to ipcStore)
  useIPC();

  // Subscribe once to session:* push channels
  useEffect(() => {
    subscribeSessionIPC();
  }, []);

  // Read IPC state from store
  const lastAlert = useIPCStore((s) => s.lastAlert);
  const status = useIPCStore((s) => s.status);

  // Settings state from Zustand store
  const {
    assistantName,
    setAssistantName,
    gamepadButton,
    setGamepadButton,
    ttsEnabled,
    setTtsEnabled,
    azureTtsEnabled,
    setAzureTtsEnabled,
    setApiKey,
    setAzureSpeechKey,
    setAzureRegion,
    setAzureVoiceName,
    setActiveGame,
  } = useSettingsStore();

  const { get: configGet } = useConfig();
  const [tab, setTab] = useState<Tab>("debriefing");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [alerts, setAlerts] = useState<NonNullable<typeof lastAlert>[]>([]);

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
      const [ak, az, key, region, voice, name, button, game] =
        await Promise.all([
          configGet("anthropicApiKey"),
          configGet("azureTtsEnabled"),
          configGet("azureSpeechKey"),
          configGet("azureRegion"),
          configGet("azureVoiceName"),
          configGet("assistantName"),
          configGet("gamepadTriggerButton"),
          configGet("activeGame"),
        ]);
      if (ak) setApiKey(ak);
      if (az) setAzureTtsEnabled(az === "true");
      if (key) setAzureSpeechKey(key);
      if (region) setAzureRegion(region);
      if (voice) setAzureVoiceName(voice);
      if (name) setAssistantName(name);
      if (button) setGamepadButton(Number(button));
      if (game === "ace" || game === "r3e") setActiveGame(game);
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
    setActiveGame,
  ]);

  // Accumulate alerts for TTSManager
  useEffect(() => {
    if (!lastAlert) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setAlerts((prev) => [...prev.slice(-19), lastAlert]);
  }, [lastAlert]);

  return (
    <div className="app">
      {/* Headless TTS */}
      <TTSManager
        alerts={alerts}
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
      <div className="title-bar text-nowrap">
        <img src={iconUrl} className="title-bar-icon" alt="" />
        <span className="title-bar-name">Sim Driving Coach</span>
        <div className="title-bar-tabs">
          <Button
            variant="link"
            className={`tab-btn ${tab === "debriefing" ? "active" : ""}`}
            onClick={() => setTab("debriefing")}
          >
            Analisi in tempo reale
          </Button>
          <Button
            variant="link"
            className={`tab-btn ${tab === "history" ? "active" : ""}`}
            onClick={() => setTab("history")}
          >
            Elenco sessioni
          </Button>
          <Button
            variant="link"
            className={`tab-btn ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            Impostazioni
          </Button>
        </div>
        <div className="title-bar-tts">
          <Button
            variant="link"
            className={`tts-toggle ${ttsEnabled ? "on" : "off"}`}
            onClick={() => setTtsEnabled(!ttsEnabled)}
            title={ttsEnabled ? "Voce attiva" : "Voce disattiva"}
          >
            {ttsEnabled ? (
              <FontAwesomeIcon icon={faMicrophone} />
            ) : (
              <FontAwesomeIcon icon={faMicrophoneSlash} />
            )}
          </Button>
        </div>
        <Button
          variant="link"
          className="title-bar-wc"
          onClick={() => window.electronAPI.windowMinimize()}
          title="Riduci a icona"
          aria-label="Riduci a icona"
        >
          <FontAwesomeIcon icon={faMinus} />
        </Button>
        <Button
          variant="link"
          className="title-bar-wc"
          onClick={() => window.electronAPI.windowMaximize()}
          title="Ingrandisci"
          aria-label="Ingrandisci finestra"
        >
          <FontAwesomeIcon icon={faExpand} />
        </Button>
        <Button
          variant="link"
          className="title-bar-close"
          onClick={() => window.electronAPI.windowClose()}
          title="Chiudi"
          aria-label="Chiudi finestra"
        >
          <FontAwesomeIcon icon={faXmark} />
        </Button>
      </div>

      {/* Main content */}
      <div className="main-content">
        {tab === "debriefing" && <RealtimeAnalysis />}
        {tab === "history" && (
          <SessionHistory onOpenSession={() => setTab("debriefing")} />
        )}
        {tab === "settings" && <SettingsPanel />}
      </div>

      {/* Status bar */}
      <StatusBar status={status} lastAlert={lastAlert} />
    </div>
  );
};

export default App;
