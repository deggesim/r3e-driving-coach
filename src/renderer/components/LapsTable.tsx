import {
  faCheck,
  faChevronRight,
  faEye,
  faEyeSlash,
  faPen,
  faTrash,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Fragment, useEffect, useState } from "react";
import { Badge, Button, Table } from "react-bootstrap";
import { formatLapTime } from "../../shared/format";
import type { LapRow, SessionSetupRow } from "../../shared/types";
import { useSessionStore } from "../store/sessionStore";
import LapTelemetryCharts from "./LapTelemetryCharts";

const buildPageWindow = (current: number, total: number): (number | "…")[] => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [];
  const addPage = (n: number) => {
    if (pages[pages.length - 1] !== n) pages.push(n);
  };
  addPage(1);
  if (current > 3) pages.push("…");
  for (
    let p = Math.max(2, current - 1);
    p <= Math.min(total - 1, current + 1);
    p++
  )
    addPage(p);
  if (current < total - 2) pages.push("…");
  addPage(total);
  return pages;
};

const PAGE_SIZE = 5;

type LapsTableProps = {
  setupById: Map<number, SessionSetupRow>;
  live?: boolean;
  onPickSetup?: (lap: LapRow) => void;
};

const LapsTable = ({ setupById, live = false, onPickSetup }: LapsTableProps) => {
  const laps = useSessionStore((s) => s.laps);
  const deleteLap = useSessionStore((s) => s.deleteLap);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hideInvalid, setHideInvalid] = useState(true);
  const [trackedLapCount, setTrackedLapCount] = useState(0);

  const parseLocalDate = (s: string) =>
    new Date(s.includes("T") ? s : s.replace(" ", "T"));

  const sortedLaps = live
    ? laps
    : [...laps].sort(
        (a, b) =>
          parseLocalDate(a.recorded_at).getTime() -
          parseLocalDate(b.recorded_at).getTime(),
      );
  const visibleLaps = hideInvalid
    ? sortedLaps.filter((l) => l.valid)
    : sortedLaps;
  const pageCount = Math.max(1, Math.ceil(visibleLaps.length / PAGE_SIZE));

  const bestLapId = laps.reduce<number | null>((best, l) => {
    if (!l.valid || l.lap_time == null) return best;
    if (best === null) return l.id;
    const bestLap = laps.find((x) => x.id === best);
    return bestLap && l.lap_time < bestLap.lap_time ? l.id : best;
  }, null);

  // Auto-advance to last page when new laps arrive (live session only).
  useEffect(() => {
    if (!live || visibleLaps.length <= trackedLapCount) return;
    setTrackedLapCount(visibleLaps.length);
    setPage(pageCount);
  }, [live, visibleLaps.length, trackedLapCount, pageCount]);

  // Close expanded row when changing page.
  const goToPage = (p: number) => {
    setPage(p);
    setExpandedId(null);
    setConfirmDeleteId(null);
  };

  const toggleHideInvalid = () => {
    setHideInvalid((v) => !v);
    setPage(1);
    setExpandedId(null);
    setConfirmDeleteId(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, lapId: number) => {
    e.stopPropagation();
    setConfirmDeleteId((cur) => (cur === lapId ? null : lapId));
    setExpandedId(null);
  };

  const handleDeleteConfirm = async (e: React.MouseEvent, lapId: number) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
    await deleteLap(lapId);
  };

  const pageLaps = visibleLaps.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggle = (id: number, valid: boolean) => {
    if (!valid) return;
    setExpandedId((cur) => (cur === id ? null : id));
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-1">
        <h6 className="text-uppercase mb-1">Giri</h6>
        {laps.length > 0 && (
          <Button
            variant={hideInvalid ? "secondary" : "outline-secondary"}
            style={{ fontSize: 12 }}
            onClick={toggleHideInvalid}
          >
            <FontAwesomeIcon
              icon={hideInvalid ? faEye : faEyeSlash}
              className="me-1"
            />
            {hideInvalid ? "Mostra non validi" : "Nascondi non validi"}
          </Button>
        )}
      </div>

      <Table
        striped
        size="sm"
        variant="dark"
        className="align-middle laps-table mb-1"
      >
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            <th>#</th>
            <th>Tempo</th>
            <th>S1</th>
            <th>S2</th>
            <th>S3</th>
            <th>Valido</th>
            <th>Setup</th>
            <th>Data</th>
            <th style={{ width: 32 }}></th>
          </tr>
        </thead>
        <tbody>
          {laps.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center text-muted">
                Nessun giro
              </td>
            </tr>
          )}
          {pageLaps.map((l) => {
            const expanded = expandedId === l.id;
            const clickable = !!l.valid;
            const isBest = l.id === bestLapId;
            const rowColor = isBest
              ? { color: "#ffc107" }
              : { color: "var(--text-dim)" };
            const tdColor = isBest ? { color: "#ffc107" } : undefined;
            return (
              <Fragment key={l.id}>
                <tr
                  onClick={() => toggle(l.id, l.valid)}
                  style={{
                    cursor: clickable ? "pointer" : "default",
                    background: expanded ? "var(--bg3)" : undefined,
                  }}
                  title={clickable ? "Mostra telemetria" : "Giro non valido"}
                >
                  <td style={rowColor}>
                    {clickable && (
                      <FontAwesomeIcon
                        icon={faChevronRight}
                        style={{
                          transition: "transform 0.25s ease",
                          transform: expanded
                            ? "rotate(90deg)"
                            : "rotate(0deg)",
                          fontSize: 12,
                        }}
                      />
                    )}
                  </td>
                  <td style={tdColor}>{l.lap_number}</td>
                  <td style={tdColor}>{formatLapTime(l.lap_time)}</td>
                  <td style={tdColor}>
                    {l.sector1 != null ? formatLapTime(l.sector1) : "--"}
                  </td>
                  <td style={tdColor}>
                    {l.sector2 != null ? formatLapTime(l.sector2) : "--"}
                  </td>
                  <td style={tdColor}>
                    {l.sector3 != null ? formatLapTime(l.sector3) : "--"}
                  </td>
                  <td>
                    {l.valid ? (
                      <FontAwesomeIcon
                        icon={faCheck}
                        className="text-success"
                      />
                    ) : (
                      <FontAwesomeIcon icon={faXmark} className="text-danger" />
                    )}
                  </td>
                  <td>
                    {l.setup_id != null && setupById.has(l.setup_id) ? (
                      <Badge
                        bg="info"
                        as="button"
                        style={{
                          maxWidth: 160,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          display: "inline-block",
                          cursor: "pointer",
                          border: "none",
                          fontSize: 12,
                        }}
                        title="Cambia setup"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          onPickSetup?.(l);
                        }}
                      >
                        {setupById.get(l.setup_id)!.setup.name ??
                          `#${l.setup_id}`}
                      </Badge>
                    ) : (
                      <button
                        className="text-muted"
                        title="Assegna setup"
                        onClick={(e) => { e.stopPropagation(); onPickSetup?.(l); }}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12 }}
                      >
                        <FontAwesomeIcon icon={faPen} style={{ opacity: 0.4 }} />
                      </button>
                    )}
                  </td>
                  <td style={isBest ? { color: "#ffc107" } : undefined}>
                    {parseLocalDate(l.recorded_at).toLocaleString("it-IT")}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ padding: "2px 4px" }}>
                    {confirmDeleteId === l.id ? (
                      <div className="d-flex gap-1">
                        <button
                          className="text-danger"
                          title="Conferma eliminazione"
                          onClick={(e) => handleDeleteConfirm(e, l.id)}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12 }}
                        >
                          <FontAwesomeIcon icon={faCheck} />
                        </button>
                        <button
                          className="text-muted"
                          title="Annulla"
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12 }}
                        >
                          <FontAwesomeIcon icon={faXmark} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="text-muted"
                        title="Elimina giro"
                        onClick={(e) => handleDeleteClick(e, l.id)}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, opacity: 0.4 }}
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    )}
                  </td>
                </tr>
                <tr className="lap-telemetry-row">
                  <td
                    colSpan={10}
                    style={{ padding: 0, background: "var(--bg2)" }}
                  >
                    <div
                      className={`lap-telemetry-wrapper${expanded ? " open" : ""}`}
                      aria-hidden={!expanded}
                    >
                      <div className="lap-telemetry-inner">
                        {expanded && <LapTelemetryCharts lap={l} />}
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </Table>

      <div className="sh-pagination d-flex align-items-center gap-2 px-0 py-1">
        <span
          className="sh-page-count text-secondary"
          style={{ fontSize: 12, whiteSpace: "nowrap" }}
        >
          {visibleLaps.length === 0
            ? "0 giri"
            : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, visibleLaps.length)} di ${visibleLaps.length}`}
        </span>
        {pageCount > 1 && (
          <>
            <Button
              variant="link"
              size="sm"
              className="sh-page-btn ms-auto"
              disabled={page === 1}
              onClick={() => goToPage(page - 1)}
            >
              ‹ Prec
            </Button>
            <div className="d-flex gap-1">
              {buildPageWindow(page, pageCount).map((entry, i, arr) =>
                entry === "…" ? (
                  <span
                    key={`ellipsis-${arr[i - 1] ?? 0}-${arr[i + 1] ?? 0}`}
                    className="sh-page-ellipsis"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={entry}
                    className={`sh-page-num ${entry === page ? "active" : ""}`}
                    onClick={() => goToPage(entry as number)}
                    variant="link"
                  >
                    {entry}
                  </Button>
                ),
              )}
            </div>
            <Button
              variant="link"
              size="sm"
              className="sh-page-btn"
              disabled={page === pageCount}
              onClick={() => goToPage(page + 1)}
            >
              Succ ›
            </Button>
          </>
        )}
      </div>
    </>
  );
};

export default LapsTable;
