/**
 * RealtimeAnalysis (exported as Debriefing for backward-compatible import).
 *
 * Top: session header with action buttons
 *   [Nuova sessione] [Chiudi sessione] [Carica setup] [Esegui analisi] [Esporta PDF]
 * Middle: laps table
 * Bottom: Accordion of session analyses (alwaysOpen; streaming placeholder when running)
 *
 * Supports both live session (mode="live") and historical (mode="historical", read-only
 * lifecycle; analyze + export PDF still enabled).
 */

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Badge,
  Accordion,
  Spinner,
  Table,
  Alert as BsAlert,
} from "react-bootstrap";
import { marked } from "marked";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlay,
  faStop,
  faGear,
  faChartLine,
  faFilePdf,
} from "@fortawesome/free-solid-svg-icons";
import type { SetupData } from "../../shared/types";
import { formatLapTime } from "../../shared/format";
import { useSettingsStore } from "../store/settingsStore";
import { useIPCStore } from "../store/ipcStore";
import { useSessionStore } from "../store/sessionStore";
import ScreenshotPicker from "./ScreenshotPicker";
import AceSetupPicker from "./AceSetupPicker";

const Debriefing = () => {
  const activeGame = useSettingsStore((s) => s.activeGame);
  const status = useIPCStore((s) => s.status);

  const session = useSessionStore((s) => s.session);
  const laps = useSessionStore((s) => s.laps);
  const setups = useSessionStore((s) => s.setups);
  const analyses = useSessionStore((s) => s.analyses);
  const streaming = useSessionStore((s) => s.streaming);
  const mode = useSessionStore((s) => s.mode);
  const loadCurrent = useSessionStore((s) => s.loadCurrent);
  const reset = useSessionStore((s) => s.reset);

  const [showPicker, setShowPicker] = useState(false);
  const [flash, setFlash] = useState<{ variant: string; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (mode === "live") void loadCurrent();
  }, [loadCurrent, mode]);

  const isLive = mode === "live";
  const sessionActive = !!session && !session.ended_at;

  const showFlash = (variant: string, text: string): void => {
    setFlash({ variant, text });
    window.setTimeout(() => setFlash(null), 4000);
  };

  const handleStart = async (): Promise<void> => {
    const res = await window.electronAPI.sessionStart();
    if (!res.ok) showFlash("danger", res.reason);
    else showFlash("success", "Sessione aperta.");
  };

  const handleEnd = async (): Promise<void> => {
    await window.electronAPI.sessionEnd();
    showFlash("secondary", "Sessione chiusa.");
  };

  const handleAnalyze = async (): Promise<void> => {
    if (!session) return;
    const res = await window.electronAPI.sessionAnalyze(
      isLive ? {} : { sessionId: session.id, game: session.game },
    );
    if (!res.ok) showFlash("danger", res.reason ?? "Errore durante l'analisi");
    else showFlash("info", "Analisi in corso…");
  };

  const handleExportPdf = async (): Promise<void> => {
    if (!session) return;
    const path = await window.electronAPI.sessionExportPdf({
      id: session.id,
      game: session.game,
    });
    if (path) showFlash("success", `PDF salvato: ${path}`);
  };

  const handleSetupConfirm = async (setup: SetupData): Promise<void> => {
    setShowPicker(false);
    try {
      await window.electronAPI.sessionLoadSetup({ setup });
      showFlash("success", `Setup caricato: ${setup.carFound}`);
    } catch (err) {
      showFlash("danger", String(err));
    }
  };

  const currentCar = session?.car_name ?? session?.car ?? status?.car ?? "";
  const currentTrack =
    session?.track_name ?? session?.track ?? status?.track ?? "";

  const setupById = useMemo(() => {
    const m = new Map<number, number>(); // setup.id → setup index (1-based)
    setups.forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [setups]);

  const renderMd = (md: string): string =>
    marked.parse(md, { async: false }) as string;

  const streamingVersion =
    streaming?.sessionId === session?.id ? streaming : null;

  return (
    <div className="d-flex flex-column h-100 overflow-hidden">
      {/* Header */}
      <div className="debriefing-header d-flex align-items-center gap-2 flex-wrap flex-shrink-0 p-2">
        {session ? (
          <>
            <span className="deb-car fw-bold">{currentCar}</span>
            <span className="deb-sep">·</span>
            <span className="deb-track">
              {currentTrack} {session.layout_name ?? session.layout}
            </span>
            <span className="deb-sep">·</span>
            <Badge bg={sessionActive ? "success" : "secondary"}>
              {sessionActive ? "Attiva" : "Chiusa"}
            </Badge>
            {!isLive && (
              <Badge bg="info" className="ms-1">
                Storica
              </Badge>
            )}
            <span className="deb-sep">·</span>
            <small className="text-muted">
              {laps.length} giri
              {session.best_lap != null &&
                ` · best ${formatLapTime(session.best_lap)}`}
            </small>
          </>
        ) : (
          <span className="deb-placeholder">
            {isLive ? "Nessuna sessione aperta" : "Caricamento sessione…"}
          </span>
        )}

        <div className="ms-auto d-flex gap-1 flex-wrap">
          {isLive && !sessionActive && (
            <Button size="sm" variant="success" onClick={handleStart}>
              <FontAwesomeIcon icon={faPlay} className="me-1" /> Nuova sessione
            </Button>
          )}
          {isLive && sessionActive && (
            <Button size="sm" variant="outline-secondary" onClick={handleEnd}>
              <FontAwesomeIcon icon={faStop} className="me-1" /> Chiudi sessione
            </Button>
          )}
          {isLive && sessionActive && (
            <Button
              size="sm"
              variant="outline-primary"
              onClick={() => setShowPicker(true)}
            >
              <FontAwesomeIcon icon={faGear} className="me-1" /> Carica setup
              {setups.length > 0 && ` (${setups.length})`}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={handleAnalyze}
            disabled={!session || (isLive && laps.length === 0)}
          >
            <FontAwesomeIcon icon={faChartLine} className="me-1" /> Esegui
            analisi
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            onClick={handleExportPdf}
            disabled={!session || analyses.length === 0}
          >
            <FontAwesomeIcon icon={faFilePdf} className="me-1" /> Esporta PDF
          </Button>
          {!isLive && (
            <Button size="sm" variant="link" onClick={reset}>
              Torna live
            </Button>
          )}
        </div>
      </div>

      {flash && (
        <BsAlert
          variant={flash.variant}
          onClose={() => setFlash(null)}
          dismissible
          className="mb-0"
        >
          {flash.text}
        </BsAlert>
      )}

      {/* Body */}
      <div className="flex-grow-1 overflow-y-auto p-3">
        {/* Laps table */}
        <h6 className="text-uppercase">Giri</h6>
        <Table striped size="sm" variant="dark" className="align-middle">
          <thead>
            <tr>
              <th>#</th>
              <th>Tempo</th>
              <th>S1</th>
              <th>S2</th>
              <th>S3</th>
              <th>Valido</th>
              <th>Setup</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {laps.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-muted">
                  Nessun giro
                </td>
              </tr>
            )}
            {laps.map((l) => (
              <tr key={l.id}>
                <td>{l.lap_number}</td>
                <td>{formatLapTime(l.lap_time)}</td>
                <td>{l.sector1 != null ? formatLapTime(l.sector1) : "--"}</td>
                <td>{l.sector2 != null ? formatLapTime(l.sector2) : "--"}</td>
                <td>{l.sector3 != null ? formatLapTime(l.sector3) : "--"}</td>
                <td>{l.valid ? "✔" : "✗"}</td>
                <td>
                  {l.setup_id != null ? (
                    <Badge bg="info">
                      #{setupById.get(l.setup_id) ?? l.setup_id}
                    </Badge>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <small>
                    {new Date(l.recorded_at).toLocaleTimeString("it-IT")}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>

        {/* Analyses accordion */}
        <h6 className="text-uppercase mt-3">Analisi</h6>
        {analyses.length === 0 && !streamingVersion && (
          <p className="small">Nessuna analisi ancora generata.</p>
        )}
        <Accordion alwaysOpen>
          {analyses.map((a) => (
            <Accordion.Item key={a.id} eventKey={`v${a.version}`}>
              <Accordion.Header>
                Analisi #{a.version}
                <span className="ms-2 small">
                  {new Date(a.created_at).toLocaleString("it-IT")}
                </span>
              </Accordion.Header>
              <Accordion.Body>
                <div
                  className="deb-content"
                  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                  dangerouslySetInnerHTML={{ __html: renderMd(a.template_v3) }}
                />
              </Accordion.Body>
            </Accordion.Item>
          ))}
          {streamingVersion && (
            <Accordion.Item eventKey={`streaming-${streamingVersion.version}`}>
              <Accordion.Header>
                <Spinner size="sm" className="me-2" />
                Analisi #{streamingVersion.version} (in corso…)
              </Accordion.Header>
              <Accordion.Body>
                <div
                  className="deb-content"
                  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                  dangerouslySetInnerHTML={{
                    __html: renderMd(streamingVersion.text),
                  }}
                />
              </Accordion.Body>
            </Accordion.Item>
          )}
        </Accordion>
      </div>

      {/* Setup pickers */}
      {activeGame === "ace" ? (
        <AceSetupPicker
          show={showPicker}
          expectedCar={currentCar}
          expectedTrack={currentTrack}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupConfirm}
        />
      ) : (
        <ScreenshotPicker
          show={showPicker}
          expectedCar={currentCar}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupConfirm}
        />
      )}
    </div>
  );
};

export default Debriefing;
