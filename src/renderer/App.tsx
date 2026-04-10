/**
 * App — Root component.
 * Layout: left panel (Debriefing + SessionHistory), right rail (settings/config), bottom bar (StatusBar).
 * TTSManager and VoiceCoachOverlay are headless/overlay — mounted globally.
 */

import { useState, useEffect, useCallback } from "react";
import { useIPC, useConfig } from "./hooks/useIPC";
import { useVoiceCoach } from "./hooks/useVoiceCoach";
import type { AzureVoice } from "../shared/types";
import iconUrl from "/icon.png";
import TTSManager from "./components/TTSManager";
import StatusBar from "./components/StatusBar";
import Debriefing from "./components/Debriefing";
import SessionHistory from "./components/SessionHistory";
import VoiceCoachOverlay from "./components/VoiceCoachOverlay";

type Tab = "debriefing" | "history" | "settings";

const AZURE_REGIONS = [
  { value: "westeurope", label: "West Europe" },
  { value: "northeurope", label: "North Europe" },
  { value: "eastus", label: "East US" },
  { value: "eastus2", label: "East US 2" },
  { value: "westus", label: "West US" },
];

const App = () => {
  const { frame, lastAlert, lastLap, status, lastAnalysis } = useIPC();
  const { get: configGet, set: configSet } = useConfig();
  const [tab, setTab] = useState<Tab>("debriefing");
  const [alerts, setAlerts] = useState<(typeof lastAlert)[]>([]);

  // ── TTS / Voice settings ─────────────────────────────────────────────────
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [azureTtsEnabled, setAzureTtsEnabled] = useState(false);
  const [azureSpeechKey, setAzureSpeechKey] = useState("");
  const [azureRegion, setAzureRegion] = useState("westeurope");
  const [azureVoiceName, setAzureVoiceName] = useState("");
  const [azureVoices, setAzureVoices] = useState<AzureVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState("");

  // ── General / AI settings ────────────────────────────────────────────────
  const [apiKey, setApiKey] = useState("");
  const [assistantName, setAssistantName] = useState("Aria");
  const [gamepadButton, setGamepadButton] = useState(0);

  // ── Save state ───────────────────────────────────────────────────────────
  const [settingSaved, setSettingSaved] = useState<string | null>(null);

  const showSaved = (key: string) => {
    setSettingSaved(key);
    setTimeout(() => setSettingSaved(null), 2000);
  };

  // ── Voice coach hook ─────────────────────────────────────────────────────
  const { state: voiceState, transcript, answer } = useVoiceCoach({
    triggerButtonIndex: gamepadButton,
    enabled: ttsEnabled,
    azureTtsEnabled,
  });

  // ── Load all settings from config on mount ───────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [
        ak, az, key, region, voice, name, button,
      ] = await Promise.all([
        configGet("anthropicApiKey"),
        configGet("azureTtsEnabled"),
        configGet("azureSpeechKey"),
        configGet("azureRegion"),
        configGet("azureVoiceName"),
        configGet("assistantName"),
        configGet("gamepadTriggerButton"),
      ]);
      if (ak) setApiKey(ak);
      if (az) setAzureTtsEnabled(az === "true");
      if (key) setAzureSpeechKey(key);
      if (region) setAzureRegion(region);
      if (voice) setAzureVoiceName(voice);
      if (name) setAssistantName(name);
      if (button) setGamepadButton(Number(button));
    };
    load().catch(console.error);
  }, [configGet]);

  // Accumulate alerts for TTSManager
  useEffect(() => {
    if (!lastAlert) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setAlerts((prev) => [...prev.slice(-19), lastAlert]);
  }, [lastAlert]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSaveApiKey = async () => {
    await configSet("anthropicApiKey", apiKey);
    showSaved("apiKey");
  };

  const handleSaveAssistant = async () => {
    await configSet("assistantName", assistantName);
    await configSet("gamepadTriggerButton", String(gamepadButton));
    showSaved("assistant");
  };

  const handleToggleAzure = async () => {
    const next = !azureTtsEnabled;
    setAzureTtsEnabled(next);
    await configSet("azureTtsEnabled", String(next));
  };

  const handleSaveAzureKey = async () => {
    await configSet("azureSpeechKey", azureSpeechKey);
    await configSet("azureRegion", azureRegion);
    showSaved("azureKey");
  };

  const handleLoadVoices = async () => {
    setVoicesLoading(true);
    setVoicesError("");
    // Save key + region first so the main process can read them
    await configSet("azureSpeechKey", azureSpeechKey);
    await configSet("azureRegion", azureRegion);
    try {
      const voices = await window.electronAPI.ttsGetVoices();
      setAzureVoices(voices);
      if (voices.length > 0 && !azureVoiceName) {
        setAzureVoiceName(voices[0].shortName);
        await configSet("azureVoiceName", voices[0].shortName);
      }
    } catch (err) {
      setVoicesError(err instanceof Error ? err.message : "Errore nel caricamento voci");
    } finally {
      setVoicesLoading(false);
    }
  };

  const handleVoiceChange = useCallback(async (shortName: string) => {
    setAzureVoiceName(shortName);
    await configSet("azureVoiceName", shortName);
    // Play preview
    try {
      const raw = await window.electronAPI.ttsTest(shortName);
      // raw is a Buffer-like object — convert to ArrayBuffer
      const bytes = new Uint8Array(Object.values(raw as unknown as Record<string, number>));
      const ctx = new AudioContext();
      const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.start(0);
      source.onended = () => ctx.close();
    } catch (err) {
      console.error("[App] Voice preview error:", err);
    }
  }, [configSet]);

  const postLapText = lastAnalysis?.section5Summary ?? null;

  return (
    <div className="app">
      {/* Headless TTS */}
      <TTSManager
        alerts={alerts.filter(Boolean) as NonNullable<typeof lastAlert>[]}
        postLapText={postLapText}
        enabled={ttsEnabled}
        azureEnabled={azureTtsEnabled}
      />

      {/* Voice coach overlay */}
      <VoiceCoachOverlay
        state={voiceState}
        transcript={transcript}
        answer={answer}
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

            {/* ── Claude API Key ── */}
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
                  {settingSaved === "apiKey" ? "✓ Salvata" : "Salva"}
                </button>
              </div>
              <span className="setting-hint">
                Necessaria per il debriefing post-giro e il coach vocale via Claude API.
              </span>
            </div>

            {/* ── Voce TTS (Web Speech) ── */}
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
                Attiva/disattiva tutti gli output vocali (alert, debriefing, coach).
              </span>
            </div>

            {/* ── Assistente Vocale ── */}
            <div className="setting-group">
              <label>Assistente Vocale</label>
              <div className="setting-row">
                <label htmlFor="assistant-name" className="setting-inline-label">
                  Nome assistente
                </label>
                <input
                  id="assistant-name"
                  type="text"
                  value={assistantName}
                  onChange={(e) => setAssistantName(e.target.value)}
                  placeholder="Aria"
                  className="setting-input setting-input-sm"
                  maxLength={32}
                />
              </div>
              <div className="setting-row">
                <label htmlFor="gamepad-button" className="setting-inline-label">
                  Tasto controller (0–19)
                </label>
                <input
                  id="gamepad-button"
                  type="number"
                  min={0}
                  max={19}
                  value={gamepadButton}
                  onChange={(e) => setGamepadButton(Number(e.target.value))}
                  className="setting-input setting-input-xs"
                />
              </div>
              <div className="setting-row">
                <button className="setting-btn" onClick={handleSaveAssistant}>
                  {settingSaved === "assistant" ? "✓ Salvato" : "Salva"}
                </button>
              </div>
              <span className="setting-hint">
                Premi il tasto configurato sul controller per attivare il microfono e fare domande al coach.
                Il tasto 0 corrisponde al tasto A su controller Xbox.
              </span>
            </div>

            {/* ── Azure TTS ── */}
            <div className="setting-group">
              <label>Azure Text-to-Speech</label>
              <div className="setting-row">
                <button
                  className={`setting-toggle ${azureTtsEnabled ? "active" : ""}`}
                  onClick={handleToggleAzure}
                >
                  {azureTtsEnabled ? "Attivo" : "Disattivo"}
                </button>
              </div>

              <div className="setting-row">
                <label htmlFor="azure-key" className="setting-inline-label">
                  Chiave servizio
                </label>
                <input
                  id="azure-key"
                  type="password"
                  value={azureSpeechKey}
                  onChange={(e) => setAzureSpeechKey(e.target.value)}
                  placeholder="Chiave Azure Speech"
                  className="setting-input"
                />
              </div>

              <div className="setting-row">
                <label htmlFor="azure-region" className="setting-inline-label">
                  Regione
                </label>
                <select
                  id="azure-region"
                  value={azureRegion}
                  onChange={(e) => setAzureRegion(e.target.value)}
                  className="setting-select"
                >
                  {AZURE_REGIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button className="setting-btn" onClick={handleSaveAzureKey}>
                  {settingSaved === "azureKey" ? "✓ Salvata" : "Salva"}
                </button>
              </div>

              <div className="setting-row">
                <button
                  className="setting-btn"
                  onClick={handleLoadVoices}
                  disabled={voicesLoading || !azureSpeechKey}
                >
                  {voicesLoading ? "Caricamento..." : "Carica voci"}
                </button>
              </div>

              {voicesError && (
                <span className="setting-error">{voicesError}</span>
              )}

              {azureVoices.length > 0 && (
                <div className="setting-row">
                  <label htmlFor="azure-voice" className="setting-inline-label">
                    Voce
                  </label>
                  <select
                    id="azure-voice"
                    value={azureVoiceName}
                    onChange={(e) => handleVoiceChange(e.target.value)}
                    className="setting-select"
                  >
                    {azureVoices.map((v) => (
                      <option key={v.shortName} value={v.shortName}>
                        {v.localName} ({v.gender === "Female" ? "F" : "M"})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <span className="setting-hint">
                Selezionando una voce viene riprodotta un'anteprima:
                "Ciao, sono {assistantName} e oggi sono il tuo insegnante virtuale".
                Richiede una sottoscrizione Azure Cognitive Services.
              </span>
            </div>

            {/* ── Debug frame ── */}
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
