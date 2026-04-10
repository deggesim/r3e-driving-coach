/**
 * App — Root component.
 * Layout: left panel (Debriefing + SessionHistory), right rail (settings/config), bottom bar (StatusBar).
 * TTSManager is headless — mounts globally.
 */

import { useState, useEffect } from "react";
import { useIPC, useConfig } from "./hooks/useIPC";
import iconUrl from "/icon.png";
import TTSManager from "./components/TTSManager";
import StatusBar from "./components/StatusBar";
import Debriefing from "./components/Debriefing";
import SessionHistory from "./components/SessionHistory";

type Tab = "debriefing" | "history" | "settings";

const App = () => {
  const { frame, lastAlert, lastLap, status, lastAnalysis } = useIPC();
  const { get: configGet, set: configSet } = useConfig();
  const [tab, setTab] = useState<Tab>("debriefing");
  const [alerts, setAlerts] = useState<(typeof lastAlert)[]>([]);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Accumulate alerts for TTSManager
  useEffect(() => {
    if (!lastAlert) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setAlerts((prev) => [...prev.slice(-19), lastAlert]);
  }, [lastAlert]);

  // Load API key from config on mount
  useEffect(() => {
    configGet("anthropicApiKey").then((val) => {
      if (val) setApiKey(val);
    });
  }, [configGet]);

  const handleSaveApiKey = async () => {
    await configSet("anthropicApiKey", apiKey);
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  };

  const postLapText = lastAnalysis?.section5Summary ?? null;

  return (
    <div className="app">
      {/* Headless TTS */}
      <TTSManager
        alerts={alerts.filter(Boolean) as NonNullable<typeof lastAlert>[]}
        postLapText={postLapText}
        enabled={ttsEnabled}
      />

      {/* Title bar (frameless window drag area) */}
      <div className="title-bar">
        <img src={iconUrl} className="title-bar-icon" alt="" />
        <span className="title-bar-name">R3E Driving Coach</span>
        <div className="title-bar-tabs">
          <button
            className={`tab-btn ${tab === "debriefing" ? "active" : ""}`}
            onClick={() => setTab("debriefing")}
          >
            Debriefing
          </button>
          <button
            className={`tab-btn ${tab === "history" ? "active" : ""}`}
            onClick={() => setTab("history")}
          >
            Storico
          </button>
          <button
            className={`tab-btn ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            Impostazioni
          </button>
        </div>
        <div className="title-bar-tts">
          <button
            className={`tts-toggle ${ttsEnabled ? "on" : "off"}`}
            onClick={() => setTtsEnabled((v) => !v)}
            title={ttsEnabled ? "Voce attiva" : "Voce disattiva"}
          >
            {ttsEnabled ? "🎙" : "🔇"}
          </button>
        </div>
        <button
          className="title-bar-close"
          onClick={() => window.electronAPI.windowClose()}
          title="Chiudi"
          aria-label="Chiudi finestra"
        >
          ✕
        </button>
      </div>

      {/* Main content */}
      <div className="main-content">
        {tab === "debriefing" && (
          <Debriefing lastLap={lastLap} lastAnalysis={lastAnalysis} />
        )}

        {tab === "history" && <SessionHistory status={status} />}

        {tab === "settings" && (
          <div className="settings-panel">
            <h2>Impostazioni</h2>

            <div className="setting-group">
              <label htmlFor="api-key">API Key Anthropic</label>
              <div className="setting-row">
                <input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="setting-input"
                />
                <button className="setting-btn" onClick={handleSaveApiKey}>
                  {apiKeySaved ? "✓ Salvata" : "Salva"}
                </button>
              </div>
              <span className="setting-hint">
                Necessaria per il debriefing post-giro via Claude API.
              </span>
            </div>

            <div className="setting-group">
              <label>Voce TTS</label>
              <div className="setting-row">
                <button
                  className={`setting-toggle ${ttsEnabled ? "active" : ""}`}
                  onClick={() => setTtsEnabled((v) => !v)}
                >
                  {ttsEnabled ? "Attiva" : "Disattiva"}
                </button>
              </div>
              <span className="setting-hint">
                Lingua: Italiano (it-IT). Tono ingegnere, velocità 0.9×.
              </span>
            </div>

            {frame && (
              <div className="setting-group debug">
                <label>Debug — Ultimo frame</label>
                <pre className="debug-frame">
                  {JSON.stringify(
                    {
                      car: frame.carName,
                      track: frame.trackName,
                      speed: frame.carSpeed.toFixed(1) + " km/h",
                      gear: frame.gear,
                      dist: frame.lapDistance.toFixed(0) + "m",
                      thr: (frame.throttle * 100).toFixed(0) + "%",
                      brk: (frame.brake * 100).toFixed(0) + "%",
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar status={status} lastAlert={lastAlert} />
    </div>
  );
};

export default App;
