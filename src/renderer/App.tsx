/**
 * App — Root component.
 * Layout: custom title bar (frameless Electron), main content area, bottom StatusBar.
 * TTSManager and VoiceCoachOverlay are headless/overlay — mounted globally.
 * Settings tab uses react-bootstrap Form/Button components.
 */

import { useEffect, useCallback } from "react";
import { Button, Form, Spinner, Container, Row, Col } from "react-bootstrap";
import { useIPC, useConfig } from "./hooks/useIPC";
import { useIPCStore } from "./store/ipcStore";
import { useSettingsStore } from "./store/settingsStore";
import { useVoiceCoach } from "./hooks/useVoiceCoach";
import { useState } from "react";
import type { AzureVoice } from "../shared/types";
import iconUrl from "/icon.png";
import TTSManager from "./components/TTSManager";
import StatusBar from "./components/StatusBar";
import Debriefing from "./components/Debriefing";
import SessionHistory from "./components/SessionHistory";
import VoiceCoachOverlay from "./components/VoiceCoachOverlay";

type Tab = "debriefing" | "history" | "settings";

const AZURE_REGIONS = [
  { value: "italynorth", label: "North Italy" },
  { value: "westeurope", label: "West Europe" },
  { value: "northeurope", label: "North Europe" },
  { value: "eastus", label: "East US" },
  { value: "eastus2", label: "East US 2" },
  { value: "westus", label: "West US" },
];

const App = () => {
  // Bootstrap IPC subscriptions (writes to ipcStore)
  useIPC();

  // Read IPC state from store
  const frame = useIPCStore((s) => s.frame);
  const lastAlert = useIPCStore((s) => s.lastAlert);
  const lastLap = useIPCStore((s) => s.lastLap);
  const status = useIPCStore((s) => s.status);
  const lastAnalysis = useIPCStore((s) => s.lastAnalysis);

  // Settings state from Zustand store
  const {
    apiKey,
    setApiKey,
    assistantName,
    setAssistantName,
    gamepadButton,
    setGamepadButton,
    ttsEnabled,
    setTtsEnabled,
    azureTtsEnabled,
    setAzureTtsEnabled,
    azureSpeechKey,
    setAzureSpeechKey,
    azureRegion,
    setAzureRegion,
    azureVoiceName,
    setAzureVoiceName,
    settingSaved,
    showSaved,
  } = useSettingsStore();

  const { get: configGet, set: configSet } = useConfig();
  const [tab, setTab] = useState<Tab>("debriefing");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [alerts, setAlerts] = useState<NonNullable<typeof lastAlert>[]>([]);
  const [azureVoices, setAzureVoices] = useState<AzureVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState("");
  const [isCapturingButton, setIsCapturingButton] = useState(false);

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
      const [ak, az, key, region, voice, name, button] = await Promise.all([
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
  ]);

  // Accumulate alerts for TTSManager
  useEffect(() => {
    if (!lastAlert) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setAlerts((prev) => [...prev.slice(-19), lastAlert]);
  }, [lastAlert]);

  // Handlers
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
    await configSet("azureSpeechKey", azureSpeechKey);
    await configSet("azureRegion", azureRegion);
    try {
      const voices = await window.electronAPI.ttsGetVoices();
      setAzureVoices(voices);
      if (voices.length > 0 && !azureVoiceName) {
        setAzureVoiceName(voices[0].ShortName);
        await configSet("azureVoiceName", voices[0].ShortName);
      }
    } catch (err) {
      setVoicesError(
        err instanceof Error ? err.message : "Errore nel caricamento voci",
      );
    } finally {
      setVoicesLoading(false);
    }
  };

  const handleVoiceChange = useCallback(
    async (shortName: string) => {
      setAzureVoiceName(shortName);
      await configSet("azureVoiceName", shortName);
      try {
        const raw = await window.electronAPI.ttsTest(shortName);
        const bytes = new Uint8Array(
          Object.values(raw as unknown as Record<string, number>),
        );
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
    },
    [configSet, setAzureVoiceName],
  );

  // Gamepad button capture: polls all buttons until one is pressed
  useEffect(() => {
    if (!isCapturingButton) return;
    const id = setInterval(() => {
      const gamepads = navigator.getGamepads();
      for (const gp of gamepads) {
        if (!gp) continue;
        for (let i = 0; i < gp.buttons.length; i++) {
          if (gp.buttons[i]?.pressed) {
            setGamepadButton(i);
            configSet("gamepadTriggerButton", String(i)).catch(console.error);
            showSaved("gamepadButton");
            setIsCapturingButton(false);
            return;
          }
        }
      }
    }, 50);
    return () => clearInterval(id);
  }, [isCapturingButton, setGamepadButton, configSet, showSaved]);

  const postLapText = lastAnalysis?.section5Summary ?? null;

  const getButtonLabel = (index: number): string => {
    const labels: Record<number, string> = {
      0: "A", 1: "B", 2: "X", 3: "Y",
      4: "LB", 5: "RB", 6: "LT", 7: "RT",
      8: "Select", 9: "Start",
      10: "L3", 11: "R3",
      12: "Su (D-pad)", 13: "Giù (D-pad)", 14: "Sinistra (D-pad)", 15: "Destra (D-pad)",
    };
    return labels[index] ?? `Tasto ${index}`;
  };

  return (
    <div className="app">
      {/* Headless TTS */}
      <TTSManager
        alerts={alerts}
        postLapText={postLapText}
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
      <div className="title-bar">
        <img src={iconUrl} className="title-bar-icon" alt="" />
        <span className="title-bar-name">R3E Driving Coach</span>
        <div className="title-bar-tabs">
          <Button
            variant="link"
            className={`tab-btn ${tab === "debriefing" ? "active" : ""}`}
            onClick={() => setTab("debriefing")}
          >
            Debriefing
          </Button>
          <Button
            variant="link"
            className={`tab-btn ${tab === "history" ? "active" : ""}`}
            onClick={() => setTab("history")}
          >
            Storico
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
            {ttsEnabled ? "🎙" : "🔇"}
          </Button>
        </div>
        <Button
          variant="link"
          className="title-bar-close"
          onClick={() => window.electronAPI.windowClose()}
          title="Chiudi"
          aria-label="Chiudi finestra"
        >
          ✕
        </Button>
      </div>

      {/* Main content */}
      <div className="main-content">
        {tab === "debriefing" && (
          <Debriefing lastLap={lastLap} lastAnalysis={lastAnalysis} />
        )}
        {tab === "history" && <SessionHistory status={status} />}

        {tab === "settings" && (
          <Container fluid className="settings-panel p-4">
            <Row>
              <Col>
                <h2 className="fs-5 fw-bold mb-4">Impostazioni</h2>

                {/* Claude API Key */}
                <Form.Group className="mb-4">
                  <Form.Label className="setting-section-label">
                    API Key Anthropic
                  </Form.Label>
                  <Row className="g-2 align-items-center">
                    <Col>
                      <Form.Control
                        id="api-key"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-ant-..."
                      />
                    </Col>
                    <Col xs="auto">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleSaveApiKey}
                      >
                        {settingSaved === "apiKey" ? "✓ Salvata" : "Salva"}
                      </Button>
                    </Col>
                  </Row>
                  <Form.Text>
                    Necessaria per il debriefing post-giro e il coach vocale via
                    Claude API.
                  </Form.Text>
                </Form.Group>

                {/* Voce TTS */}
                <Form.Group className="mb-4">
                  <Form.Label className="setting-section-label">
                    Voce TTS
                  </Form.Label>
                  <Row className="g-2 align-items-center">
                    <Col xs="auto">
                      <Button
                        variant={ttsEnabled ? "success" : "secondary"}
                        size="sm"
                        onClick={() => setTtsEnabled(!ttsEnabled)}
                      >
                        {ttsEnabled ? "Attiva" : "Disattiva"}
                      </Button>
                    </Col>
                  </Row>
                  <Form.Text>
                    Attiva/disattiva tutti gli output vocali (alert, debriefing,
                    coach).
                  </Form.Text>
                </Form.Group>

                {/* Assistente Vocale */}
                <Form.Group className="mb-4">
                  <Form.Label className="setting-section-label">
                    Assistente Vocale
                  </Form.Label>
                  <Row className="g-2 align-items-center mb-2">
                    <Col xs="auto">
                      <Form.Label htmlFor="assistant-name" className="mb-0">
                        Nome assistente
                      </Form.Label>
                    </Col>
                    <Col xs={4}>
                      <Form.Control
                        id="assistant-name"
                        type="text"
                        value={assistantName}
                        onChange={(e) => setAssistantName(e.target.value)}
                        placeholder="Aria"
                        maxLength={32}
                      />
                    </Col>
                  </Row>
                  <Row className="g-2 align-items-center mb-2">
                    <Col xs="auto">
                      <Form.Label className="mb-0">
                        Tasto controller
                      </Form.Label>
                    </Col>
                    <Col xs="auto">
                      {isCapturingButton ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          <span className="text-warning me-2">
                            Premi un tasto sul controller…
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setIsCapturingButton(false)}
                          >
                            Annulla
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="badge bg-secondary me-2 fs-6 fw-normal">
                            {getButtonLabel(gamepadButton)}{" "}
                            <span className="text-white-50">({gamepadButton})</span>
                          </span>
                          <Button
                            variant="outline-light"
                            size="sm"
                            onClick={() => setIsCapturingButton(true)}
                          >
                            Assegna
                          </Button>
                          {settingSaved === "gamepadButton" && (
                            <span className="text-success ms-2">✓ Salvato</span>
                          )}
                        </>
                      )}
                    </Col>
                  </Row>
                  <Row className="g-2 align-items-center">
                    <Col xs="auto">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleSaveAssistant}
                      >
                        {settingSaved === "assistant" ? "✓ Salvato" : "Salva"}
                      </Button>
                    </Col>
                  </Row>
                  <Form.Text>
                    Premi il tasto configurato sul controller per attivare il
                    microfono e fare domande al coach. Il tasto 0 corrisponde al
                    tasto A su controller Xbox.
                  </Form.Text>
                </Form.Group>

                {/* Azure TTS */}
                <Form.Group className="mb-4">
                  <Form.Label className="setting-section-label">
                    Azure Text-to-Speech
                  </Form.Label>
                  <Row className="g-2 align-items-center mb-2">
                    <Col xs="auto">
                      <Button
                        variant={azureTtsEnabled ? "success" : "secondary"}
                        size="sm"
                        onClick={handleToggleAzure}
                      >
                        {azureTtsEnabled ? "Attivo" : "Disattivo"}
                      </Button>
                    </Col>
                  </Row>
                  <Row className="g-2 align-items-center mb-2">
                    <Col xs="auto">
                      <Form.Label htmlFor="azure-key" className="mb-0">
                        Chiave servizio
                      </Form.Label>
                    </Col>
                    <Col>
                      <Form.Control
                        id="azure-key"
                        type="password"
                        value={azureSpeechKey}
                        onChange={(e) => setAzureSpeechKey(e.target.value)}
                        placeholder="Chiave Azure Speech"
                      />
                    </Col>
                  </Row>
                  <Row className="g-2 align-items-center mb-2">
                    <Col xs="auto">
                      <Form.Label htmlFor="azure-region" className="mb-0">
                        Regione
                      </Form.Label>
                    </Col>
                    <Col>
                      <Form.Select
                        id="azure-region"
                        value={azureRegion}
                        onChange={(e) => setAzureRegion(e.target.value)}
                      >
                        {AZURE_REGIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </Form.Select>
                    </Col>
                    <Col xs="auto">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleSaveAzureKey}
                      >
                        {settingSaved === "azureKey" ? "✓ Salvata" : "Salva"}
                      </Button>
                    </Col>
                  </Row>
                  <Row className="g-2 align-items-center mb-2">
                    <Col xs="auto">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleLoadVoices}
                        disabled={voicesLoading || !azureSpeechKey}
                      >
                        {voicesLoading ? (
                          <>
                            <Spinner size="sm" className="me-1" />
                            Caricamento...
                          </>
                        ) : (
                          "Carica voci"
                        )}
                      </Button>
                    </Col>
                  </Row>
                  {voicesError && (
                    <p className="text-danger small mt-1 mb-2">{voicesError}</p>
                  )}
                  {azureVoices.length > 0 && (
                    <Row className="g-2 align-items-center mb-2">
                      <Col xs="auto">
                        <Form.Label htmlFor="azure-voice" className="mb-0">
                          Voce
                        </Form.Label>
                      </Col>
                      <Col>
                        <Form.Select
                          id="azure-voice"
                          value={azureVoiceName}
                          onChange={(e) => handleVoiceChange(e.target.value)}
                        >
                          {azureVoices.map((v) => (
                            <option key={v.ShortName} value={v.ShortName}>
                              {v.LocalName} ({v.Gender === "Female" ? "F" : "M"}
                              )
                            </option>
                          ))}
                        </Form.Select>
                      </Col>
                    </Row>
                  )}
                  <Form.Text>
                    Selezionando una voce viene riprodotta un&apos;anteprima:
                    &quot;Ciao, sono {assistantName} e oggi sono il tuo
                    insegnante virtuale&quot;. Richiede una sottoscrizione Azure
                    Cognitive Services.
                  </Form.Text>
                </Form.Group>

                {/* Debug frame */}
                {frame && (
                  <div className="mt-4 pt-4 border-top">
                    <Form.Label className="setting-section-label">
                      Debug — Ultimo frame
                    </Form.Label>
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
              </Col>
            </Row>
          </Container>
        )}
      </div>

      {/* Status bar */}
      <StatusBar status={status} lastAlert={lastAlert} />
    </div>
  );
};

export default App;
