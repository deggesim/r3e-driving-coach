/**
 * SessionHistory — List of past laps + detail panel with setup and PDF export.
 * Loads all laps from the DB (all cars/tracks, works offline).
 * Filter dropdowns: car (name + class) and circuit/layout.
 * Sortable by saved date (default, newest first) or lap time (fastest first).
 */

import {
  faArrowLeft,
  faCheck,
  faFilePdf,
  faFlask,
  faGear,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Col, Form, Row, Spinner } from "react-bootstrap";
import type { LapRowFull, SetupData, SetupParam } from "../../shared/types";
import { formatLapTime } from "../../shared/format";
import { MOCK_LAP } from "../mocks/mockLap";
import { useSettingsStore } from "../store/settingsStore";
import { useIPCStore } from "../store/ipcStore";
import ScreenshotPicker from "./ScreenshotPicker";

const PAGE_SIZE = 10;

const renderMarkdown = (md: string): string =>
  marked.parse(md, { async: false }) as string;

const formatDate = (iso: string): string => {
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" (UTC, no indicator).
  // Without explicit UTC marker V8 parses it as local time — normalize first.
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(normalized).toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

type DetailPanelProps = {
  lap: LapRowFull;
  fromPage: number;
  onBack: () => void;
  onSetupSaved: (lapId: number, setup: SetupData) => void;
};

const DetailPanel = ({
  lap,
  fromPage,
  onBack,
  onSetupSaved,
}: DetailPanelProps) => {
  const [showPicker, setShowPicker] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const analysis = lap.analysis_json ? JSON.parse(lap.analysis_json) : null;
  const setup: SetupData | null = lap.setup_json
    ? JSON.parse(lap.setup_json)
    : null;
  const screenshots: string[] = lap.setup_screenshots
    ? JSON.parse(lap.setup_screenshots)
    : [];

  const handleSetupSaved = async (decoded: SetupData): Promise<void> => {
    setShowPicker(false);
    await window.electronAPI.saveSetup({ lapId: lap.id, setup: decoded });
    onSetupSaved(lap.id, decoded);
  };

  const handleExportPdf = async (): Promise<void> => {
    setExporting(true);
    setExportMsg(null);
    try {
      let path: string | null;
      if (lap.id === -1) {
        path = await window.electronAPI.exportPdfFromData({
          lapNumber: lap.lap_number,
          lapTime: lap.lap_time,
          sector1: lap.sector1,
          sector2: lap.sector2,
          sector3: lap.sector3,
          car: lap.car_name,
          track: lap.track_name,
          layout: lap.layout_name,
          recordedAt: lap.recorded_at,
          analysisJson: lap.analysis_json,
          setupJson: lap.setup_json,
        });
      } else {
        path = await window.electronAPI.exportPdf({ lapId: lap.id });
      }
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
        <Button
          variant="link"
          size="sm"
          className="detail-back-btn"
          onClick={onBack}
        >
          <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
          Pag. {fromPage}
        </Button>
        <span className="deb-sep">·</span>
        <span className="detail-lap">Giro {lap.lap_number}</span>
        <span className="deb-sep">·</span>
        <span className="detail-time">{formatLapTime(lap.lap_time)}</span>
        {lap.sector1 && (
          <span className="detail-sectors">
            S1 {formatLapTime(lap.sector1)} · S2 {formatLapTime(lap.sector2)} ·
            S3 {formatLapTime(lap.sector3)}
          </span>
        )}
        {!lap.valid && (
          <Badge bg="warning" text="dark" className="ms-1">
            Non valido
          </Badge>
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

        {analysis?.templateV3 && (
          <div
            className="deb-content p-3"
            // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(analysis.templateV3),
            }}
          />
        )}

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
                <span
                  className="text-secondary ms-auto"
                  style={{ fontSize: 11 }}
                >
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
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(setup.setupText),
                  }}
                />
              )
            )}
          </div>
        )}
      </div>

      <ScreenshotPicker
        show={showPicker}
        expectedCar={lap.car_name}
        onClose={() => setShowPicker(false)}
        onConfirm={handleSetupSaved}
      />
    </div>
  );
};

const SessionHistory = () => {
  const mockHistoryMode = useSettingsStore((s) => s.mockHistoryMode);
  const lastAnalysis = useIPCStore((s) => s.lastAnalysis);

  const [allLaps, setAllLaps] = useState<LapRowFull[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLap, setSelectedLap] = useState<LapRowFull | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterCar, setFilterCar] = useState("");
  const [filterTrack, setFilterTrack] = useState("");
  const [sortBy, setSortBy] = useState<"date" | "laptime">("date");

  const loadLaps = (): void => {
    if (mockHistoryMode) {
      setAllLaps([MOCK_LAP]);
      setSelectedLap(null);
      setCurrentPage(1);
      return;
    }
    if (!window.electronAPI) return;
    setLoading(true);
    window.electronAPI
      .getAllLaps()
      .then((data) => {
        setAllLaps(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  // Load on mount and when mock mode changes
  useEffect(() => {
    loadLaps();
    // Reset filters when switching mode
    setFilterCar("");
    setFilterTrack("");
    setCurrentPage(1);
    setSelectedLap(null);
  }, [mockHistoryMode]);

  // Reload when a new lap analysis is saved
  useEffect(() => {
    if (!mockHistoryMode && lastAnalysis) {
      loadLaps();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAnalysis]);

  // Reset page when filters or sort change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterCar, filterTrack, sortBy]);

  // Distinct cars for the dropdown
  const carOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const lap of allLaps) {
      if (!seen.has(lap.car)) {
        const label = lap.car_class_name
          ? `${lap.car_name} (${lap.car_class_name})`
          : lap.car_name;
        seen.set(lap.car, label);
      }
    }
    return Array.from(seen.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allLaps]);

  // Distinct track+layout combos for the dropdown
  const trackOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const lap of allLaps) {
      const key = `${lap.track}|${lap.layout}`;
      if (!seen.has(key)) {
        seen.set(key, `${lap.track_name} (${lap.layout_name})`);
      }
    }
    return Array.from(seen.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allLaps]);

  // Filtered + sorted laps
  const filteredLaps = useMemo(() => {
    let result = allLaps;
    if (filterCar) result = result.filter((l) => l.car === filterCar);
    if (filterTrack) {
      const [trackId, layoutId] = filterTrack.split("|");
      result = result.filter(
        (l) => l.track === trackId && l.layout === layoutId,
      );
    }
    if (sortBy === "laptime") {
      return [...result].sort((a, b) => {
        // Laps with no recorded time (out-lap, lap_time = -1) go to the bottom
        const aValid = a.lap_time > 0;
        const bValid = b.lap_time > 0;
        if (aValid && !bValid) return -1;
        if (!aValid && bValid) return 1;
        return a.lap_time - b.lap_time;
      });
    }
    // "date": already ordered DESC from the DB query
    return result;
  }, [allLaps, filterCar, filterTrack, sortBy]);

  const handleSetupSaved = (lapId: number, setup: SetupData): void => {
    setAllLaps((prev) =>
      prev.map((l) =>
        l.id === lapId
          ? {
              ...l,
              setup_json: JSON.stringify(setup),
              setup_screenshots: JSON.stringify(setup.screenshots),
            }
          : l,
      ),
    );
    setSelectedLap((prev) =>
      prev && prev.id === lapId
        ? {
            ...prev,
            setup_json: JSON.stringify(setup),
            setup_screenshots: JSON.stringify(setup.screenshots),
          }
        : prev,
    );
  };

  const totalPages = Math.max(1, Math.ceil(filteredLaps.length / PAGE_SIZE));
  const pagedLaps = filteredLaps.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  if (selectedLap) {
    return (
      <div className="session-history h-100 d-flex flex-column overflow-hidden">
        <DetailPanel
          lap={selectedLap}
          fromPage={currentPage}
          onBack={() => setSelectedLap(null)}
          onSetupSaved={handleSetupSaved}
        />
      </div>
    );
  }

  return (
    <div className="session-history h-100 d-flex flex-column overflow-hidden">
      {/* Title row */}
      <Row className="mb-0 align-items-baseline g-0 flex-shrink-0 px-3 pt-3 pb-2">
        <Col xs="auto" className="sh-title me-2">
          Storico giri
        </Col>
        {mockHistoryMode && (
          <Col xs="auto">
            <Badge bg="warning" text="dark" style={{ fontSize: 10 }}>
              <FontAwesomeIcon icon={faFlask} className="me-1" />
              Mock
            </Badge>
          </Col>
        )}
      </Row>

      {/* Filter + sort bar */}
      <div className="sh-filter-bar flex-shrink-0">
        <Form.Select
          size="sm"
          className="sh-filter-select"
          value={filterCar}
          onChange={(e) => setFilterCar(e.target.value)}
          style={{ maxWidth: 280 }}
        >
          <option value="">Tutte le auto</option>
          {carOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Form.Select>

        <Form.Select
          size="sm"
          className="sh-filter-select"
          value={filterTrack}
          onChange={(e) => setFilterTrack(e.target.value)}
          style={{ maxWidth: 260 }}
        >
          <option value="">Tutti i circuiti</option>
          {trackOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Form.Select>

        <Form.Select
          size="sm"
          className="sh-filter-select ms-auto"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "date" | "laptime")}
          style={{ maxWidth: 160 }}
        >
          <option value="date">Data ↓</option>
          <option value="laptime">Tempo sul giro</option>
        </Form.Select>
      </div>

      <div className="overflow-y-auto flex-grow-1 px-3">
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-secondary py-3">
            <Spinner size="sm" variant="danger" /> Caricamento...
          </div>
        ) : !mockHistoryMode && (!filterCar || !filterTrack) ? (
          <p className="text-secondary py-2 mb-0">
            Seleziona auto e circuito per visualizzare i giri.
          </p>
        ) : filteredLaps.length === 0 ? (
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
                <th>Data</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedLaps.map((lap) => (
                <tr
                  key={lap.id}
                  className="sh-row"
                  onClick={() => setSelectedLap(lap)}
                >
                  <td>{lap.lap_number}</td>
                  <td className="sh-laptime">{formatLapTime(lap.lap_time)}</td>
                  <td>{formatLapTime(lap.sector1)}</td>
                  <td>{formatLapTime(lap.sector2)}</td>
                  <td>{formatLapTime(lap.sector3)}</td>
                  <td className="sh-date">{formatDate(lap.recorded_at)}</td>
                  <td>
                    {lap.setup_json && (
                      <FontAwesomeIcon
                        icon={faGear}
                        className="sh-has-setup"
                        aria-label="Setup disponibile"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="sh-pagination d-flex align-items-center gap-2 px-3 py-2 flex-shrink-0">
          <Button
            variant="link"
            size="sm"
            className="sh-page-btn"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            ‹ Prec
          </Button>
          <div className="sh-page-numbers d-flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                className={`sh-page-num ${page === currentPage ? "active" : ""}`}
                onClick={() => setCurrentPage(page)}
                type="button"
              >
                {page}
              </button>
            ))}
          </div>
          <Button
            variant="link"
            size="sm"
            className="sh-page-btn"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            Succ ›
          </Button>
        </div>
      )}
    </div>
  );
};

export default SessionHistory;
