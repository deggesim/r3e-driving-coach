import { useEffect, useCallback, useState } from "react";
import {
  Button,
  Form,
  Spinner,
  Container,
  Row,
  Col,
  Badge,
} from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { useConfig } from "../hooks/useIPC";
import { useIPCStore } from "../store/ipcStore";
import { useSettingsStore } from "../store/settingsStore";
import type { AzureVoice } from "../../shared/types";

const AZURE_REGIONS = [
  { value: "italynorth", label: "North Italy" },
  { value: "westeurope", label: "West Europe" },
  { value: "northeurope", label: "North Europe" },
  { value: "eastus", label: "East US" },
  { value: "eastus2", label: "East US 2" },
  { value: "westus", label: "West US" },
];

const getButtonLabel = (index: number): string => {
  const labels: Record<number, string> = {
    0: "A",
    1: "B",
    2: "X",
    3: "Y",
    4: "LB",
    5: "RB",
    6: "LT",
    7: "RT",
    8: "Select",
    9: "Start",
    10: "L3",
    11: "R3",
    12: "Su (D-pad)",
    13: "Giù (D-pad)",
    14: "Sinistra (D-pad)",
    15: "Destra (D-pad)",
  };
  return labels[index] ?? `Tasto ${index}`;
};

const SettingsPanel = () => {
  const frame = useIPCStore((s) => s.frame);

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
    mockHistoryMode,
    setMockHistoryMode,
    settingSaved,
    showSaved,
  } = useSettingsStore();

  const { set: configSet } = useConfig();

  const [azureVoices, setAzureVoices] = useState<AzureVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState("");
  const [isCapturingButton, setIsCapturingButton] = useState(false);

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
        console.error("[SettingsPanel] Voice preview error:", err);
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

  return (
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
                <Button variant="danger" onClick={handleSaveApiKey}>
                  {settingSaved === "apiKey" ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> Salvata
                    </>
                  ) : (
                    "Salva"
                  )}
                </Button>
              </Col>
            </Row>
            <Form.Text>
              Necessaria per il debriefing post-giro e il coach vocale via
              Claude API.
            </Form.Text>
          </Form.Group>

          <hr className="mb-4" />

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
              <Col xs={3}>
                <Form.Control
                  id="assistant-name"
                  type="text"
                  value={assistantName}
                  onChange={(e) => setAssistantName(e.target.value)}
                  placeholder="Aria"
                  maxLength={16}
                />
              </Col>
              <Col xs="auto">
                <Button variant="danger" onClick={handleSaveAssistant}>
                  {settingSaved === "assistant" ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> Salvato
                    </>
                  ) : (
                    "Salva"
                  )}
                </Button>
              </Col>
            </Row>

            <Row className="g-2 align-items-center mb-2">
              <Col xs="auto">
                <Form.Label className="mb-0">Tasto controller</Form.Label>
              </Col>
              <Col xs="auto">
                {isCapturingButton ? (
                  <>
                    <Spinner animation="border" className="me-2" />
                    <span className="text-warning me-2">
                      Premi un tasto sul controller…
                    </span>
                    <Button
                      variant="secondary"
                      onClick={() => setIsCapturingButton(false)}
                    >
                      Annulla
                    </Button>
                  </>
                ) : (
                  <>
                    <Badge bg="secondary" className="me-2">
                      {gamepadButton !== null
                        ? getButtonLabel(gamepadButton)
                        : "Nessun tasto assegnato"}
                    </Badge>
                    <Button
                      variant="outline-light"
                      onClick={() => setIsCapturingButton(true)}
                    >
                      Assegna
                    </Button>
                    {settingSaved === "gamepadButton" && (
                      <span className="text-success ms-2">
                        <FontAwesomeIcon icon={faCheck} /> Salvato
                      </span>
                    )}
                  </>
                )}
              </Col>
            </Row>
            <Form.Text>
              Premi il tasto configurato sul controller per attivare il
              microfono e fare domande al coach. Il tasto 0 corrisponde al tasto
              A su controller Xbox.
            </Form.Text>
          </Form.Group>

          <hr className="mb-4" />

          {/* Azure TTS */}
          <Form.Group className="mb-4">
            <Form.Label className="setting-section-label">
              Azure Text-to-Speech
            </Form.Label>
            <Row className="g-2 align-items-center mb-2">
              <Col xs="auto">
                <Button
                  variant={azureTtsEnabled ? "success" : "secondary"}
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
                <Button variant="danger" onClick={handleSaveAzureKey}>
                  {settingSaved === "azureKey" ? "✓ Salvata" : "Salva"}
                </Button>
              </Col>
            </Row>
            <Row className="g-2 align-items-center mb-2">
              <Col xs="auto">
                <Button
                  variant="secondary"
                  onClick={handleLoadVoices}
                  disabled={voicesLoading || !azureSpeechKey}
                >
                  {voicesLoading ? (
                    <>
                      <Spinner className="me-1" />
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
                        {v.LocalName} ({v.Gender === "Female" ? "F" : "M"})
                      </option>
                    ))}
                  </Form.Select>
                </Col>
              </Row>
            )}
            <Form.Text>
              Selezionando una voce viene riprodotta un&apos;anteprima:
              &quot;Ciao, sono {assistantName} e oggi sono il tuo insegnante
              virtuale&quot;. Richiede una sottoscrizione Azure Cognitive
              Services.
            </Form.Text>
          </Form.Group>

          {/* Voce TTS */}
          <Form.Group className="mb-4">
            <Form.Label className="setting-section-label">Voce TTS</Form.Label>
            <Row className="g-2 align-items-center">
              <Col xs="auto">
                <Button
                  variant={ttsEnabled ? "success" : "secondary"}
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

          {/* Dev / Test */}
          <div className="mt-4 pt-4 border-top">
            <Form.Label className="setting-section-label">
              Test &amp; sviluppo
            </Form.Label>
            <Row className="g-2 align-items-center mb-1">
              <Col xs="auto">
                <Button
                  variant={mockHistoryMode ? "warning" : "outline-secondary"}
                  onClick={() => setMockHistoryMode(!mockHistoryMode)}
                >
                  {mockHistoryMode ? "Mock attivo" : "Mock disattivo"}
                </Button>
              </Col>
              <Col>
                <span className="text-secondary" style={{ fontSize: 12 }}>
                  Mostra analisi mock nello storico
                </span>
              </Col>
            </Row>
            <Form.Text>
              Quando attivo, lo storico mostra un giro fittizio con analisi e
              setup precompilati. Utile per testare la selezione screenshot e
              l&apos;esportazione PDF senza una sessione reale.
            </Form.Text>
          </div>
        </Col>
      </Row>
    </Container>
  );
};

export default SettingsPanel;
