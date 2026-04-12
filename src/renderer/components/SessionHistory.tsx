/**
 * SessionHistory — List of past laps + detail panel with setup and PDF export.
 * Clicking a lap row opens the detail panel (analysis markdown + setup table).
 * "Aggiungi Setup" opens the ScreenshotPicker modal.
 * "Esporta PDF" calls the main-process PDF generator with a native save dialog.
 */

import { faCheck, faFilePdf, faGear, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { marked } from "marked";
import { useEffect, useState } from "react";
import { Badge, Button, Col, Row, Spinner } from "react-bootstrap";
import type { LapRow, R3EStatus, SetupData, SetupParam } from "../../shared/types";
import ScreenshotPicker from "./ScreenshotPicker";

type SessionHistoryProps = {
  status: R3EStatus;
};

const formatLapTime = (seconds: number | null): string => {
  if (!seconds || seconds <= 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0
    ? `${mins}:${secs.toFixed(3).padStart(6, "0")}`
    : `${secs.toFixed(3)}s`;
};

const renderMarkdown = (md: string): string =>
  marked.parse(md, { async: false }) as string;

type DetailPanelProps = {
  lap: LapRow;
  car: string;
  onClose: () => void;
  onSetupSaved: (lapId: number, setup: SetupData) => void;
};

const DetailPanel = ({ lap, car, onClose, onSetupSaved }: DetailPanelProps) => {
  const [showPicker, setShowPicker] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const analysis = lap.analysis_json ? JSON.parse(lap.analysis_json) : null;
  const setup: SetupData | null = lap.setup_json ? JSON.parse(lap.setup_json) : null;
  const screenshots: string[] = lap.setup_screenshots ? JSON.parse(lap.setup_screenshots) : [];

  const handleSetupSaved = async (decoded: SetupData): Promise<void> => {
    setShowPicker(false);
    await window.electronAPI.saveSetup({ lapId: lap.id, setup: decoded });
    onSetupSaved(lap.id, decoded);
  };

  const handleExportPdf = async (): Promise<void> => {
    setExporting(true);
    setExportMsg(null);
    try {
      const path = await window.electronAPI.exportPdf({ lapId: lap.id });
      setExportMsg(path ? `Salvato: ${path}` : null);
    } catch {
      setExportMsg("Errore durante l'esportazione.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="detail-panel d-flex flex-column h-100">
      {/* Panel header */}
      <div className="detail-header d-flex align-items-center gap-2">
        <span className="detail-lap">Giro {lap.lap_number}</span>
        <span className="deb-sep">·</span>
        <span className="detail-time">{formatLapTime(lap.lap_time)}</span>
        {lap.sector1 && (
          <span className="detail-sectors">
            S1 {formatLapTime(lap.sector1)} · S2 {formatLapTime(lap.sector2)} · S3 {formatLapTime(lap.sector3)}
          </span>
        )}
        {!lap.valid && (
          <Badge bg="warning" text="dark" className="ms-1">Non valido</Badge>
        )}
        <div className="ms-auto d-flex gap-2 align-items-center">
          <Button
            variant="outline-secondary"
            size="sm"
            className="detail-action-btn"
            onClick={() => setShowPicker(true)}
          >
            <FontAwesomeIcon icon={faGear} className="me-1" />
            {setup ? "Aggiorna Setup" : "Aggiungi Setup"}
          </Button>
          {analysis && (
            <Button
              variant="danger"
              size="sm"
              className="detail-action-btn"
              disabled={exporting}
              onClick={handleExportPdf}
            >
              {exporting ? (
                <Spinner size="sm" className="me-1" />
              ) : (
                <FontAwesomeIcon icon={faFilePdf} className="me-1" />
              )}
              Esporta PDF
            </Button>
          )}
          <Button variant="link" size="sm" className="detail-close-btn" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} />
          </Button>
        </div>
      </div>

      {exportMsg && (
        <div className="detail-export-msg px-3 py-1">
          <FontAwesomeIcon icon={faCheck} className="me-1 text-success" />
          {exportMsg}
        </div>
      )}

      {/* Panel body: analysis + setup side by side when both present */}
      <div className="detail-body flex-grow-1 overflow-y-auto">
        {!analysis && !setup && (
          <div className="d-flex align-items-center justify-content-center h-100 text-secondary">
            Nessuna analisi disponibile per questo giro.
          </div>
        )}

        {/* Analysis markdown */}
        {analysis?.templateV3 && (
          <div
            className="deb-content p-3"
            // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
            dangerouslySetInnerHTML={{ __html: renderMarkdown(analysis.templateV3) }}
          />
        )}

        {/* Setup section */}
        {setup && (
          <div className="setup-section p-3 mt-2">
            <div className="setup-section-header d-flex align-items-center gap-2 mb-2">
              <FontAwesomeIcon icon={faGear} />
              <span className="setup-section-title">Setup Auto</span>
              {setup.carVerified ? (
                <Badge bg="success" className="ms-2">
                  <FontAwesomeIcon icon={faCheck} className="me-1" />
                  {setup.carFound}
                </Badge>
              ) : (
                <Badge bg="warning" text="dark" className="ms-2">
                  {setup.carFound || "Auto non verificata"}
                </Badge>
              )}
              {screenshots.length > 0 && (
                <span className="text-secondary ms-auto" style={{ fontSize: 11 }}>
                  {screenshots.length} screenshot
                </span>
              )}
            </div>

            {setup.params.length > 0 ? (
              <table className="setup-table w-100">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Parametro</th>
                    <th>Valore</th>
                  </tr>
                </thead>
                <tbody>
                  {setup.params.map((p: SetupParam, i: number) => (
                    <tr key={i}>
                      <td className="text-dim">{p.category}</td>
                      <td>{p.parameter}</td>
                      <td className="setup-value">{p.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              setup.setupText && (
                <div
                  className="deb-content"
                  // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(setup.setupText) }}
                />
              )
            )}
          </div>
        )}
      </div>

      <ScreenshotPicker
        show={showPicker}
        expectedCar={car}
        onClose={() => setShowPicker(false)}
        onConfirm={handleSetupSaved}
      />
    </div>
  );
};

const SessionHistory = ({ status }: SessionHistoryProps) => {
  const [laps, setLaps] = useState<LapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLap, setSelectedLap] = useState<LapRow | null>(null);

  useEffect(() => {
    if (!status.car || !status.track || !window.electronAPI) return;

    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoading(true);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setSelectedLap(null);
    window.electronAPI
      .getLaps({ car: status.car, track: status.track })
      .then((data) => {
        setLaps(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status.car, status.track]);

  const handleSetupSaved = (lapId: number, setup: SetupData): void => {
    // Update the local laps list so the detail panel reflects the new setup
    setLaps((prev) =>
      prev.map((l) =>
        l.id === lapId
          ? { ...l, setup_json: JSON.stringify(setup), setup_screenshots: JSON.stringify(setup.screenshots) }
          : l,
      ),
    );
    setSelectedLap((prev) =>
      prev && prev.id === lapId
        ? { ...prev, setup_json: JSON.stringify(setup), setup_screenshots: JSON.stringify(setup.screenshots) }
        : prev,
    );
  };

  if (!status.car) {
    return (
      <div className="session-history d-flex align-items-center justify-content-center text-secondary h-100">
        <span>Nessuna sessione attiva</span>
      </div>
    );
  }

  return (
    <div className="session-history h-100 d-flex flex-column overflow-hidden">
      {/* List / detail split */}
      <div className="sh-split flex-grow-1 d-flex overflow-hidden">
        {/* Left: lap list */}
        <div className={`sh-list ${selectedLap ? "sh-list--narrow" : ""} d-flex flex-column overflow-hidden`}>
          <Row className="mb-2 align-items-baseline g-0 flex-shrink-0 px-3 pt-3">
            <Col xs="auto" className="sh-title me-2">Storico giri</Col>
            <Col className="sh-subtitle">{status.car} · {status.track}</Col>
          </Row>

          <div className="overflow-y-auto flex-grow-1 px-3 pb-3">
            {loading ? (
              <div className="d-flex align-items-center gap-2 text-secondary py-3">
                <Spinner size="sm" variant="danger" /> Caricamento...
              </div>
            ) : laps.length === 0 ? (
              <p className="text-secondary py-2 mb-0">
                Nessun giro registrato per questa combinazione.
              </p>
            ) : (
              <table className="sh-table w-100">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Tempo</th>
                    <th>S1</th>
                    <th>S2</th>
                    <th>S3</th>
                    <th>V</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {laps.map((lap) => (
                    <tr
                      key={lap.id}
                      className={`sh-row ${!lap.valid ? "invalid" : ""} ${selectedLap?.id === lap.id ? "active" : ""}`}
                      onClick={() => setSelectedLap(lap.id === selectedLap?.id ? null : lap)}
                    >
                      <td>{lap.lap_number}</td>
                      <td className="sh-laptime">{formatLapTime(lap.lap_time)}</td>
                      <td>{formatLapTime(lap.sector1)}</td>
                      <td>{formatLapTime(lap.sector2)}</td>
                      <td>{formatLapTime(lap.sector3)}</td>
                      <td>
                        {lap.valid ? (
                          <Badge bg="success" pill><FontAwesomeIcon icon={faCheck} /></Badge>
                        ) : (
                          <Badge bg="secondary" pill><FontAwesomeIcon icon={faXmark} /></Badge>
                        )}
                      </td>
                      <td>
                        {lap.setup_json && (
                          <FontAwesomeIcon icon={faGear} className="sh-has-setup" title="Setup disponibile" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        {selectedLap && (
          <div className="sh-detail flex-grow-1 overflow-hidden border-start border-secondary">
            <DetailPanel
              lap={selectedLap}
              car={status.car ?? ""}
              onClose={() => setSelectedLap(null)}
              onSetupSaved={handleSetupSaved}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionHistory;
