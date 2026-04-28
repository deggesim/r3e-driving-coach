import { Fragment, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faXmark,
  faChevronRight,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import { Badge, Button, Table } from "react-bootstrap";

function buildPageWindow(current: number, total: number): (number | "…")[] {
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
}
import { formatLapTime } from "../../shared/format";
import { useSessionStore } from "../store/sessionStore";
import LapTelemetryCharts from "./LapTelemetryCharts";

const PAGE_SIZE = 5;

type LapsTableProps = {
  setupById: Map<number, string>;
};

const LapsTable = ({ setupById }: LapsTableProps) => {
  const laps = useSessionStore((s) => s.laps);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hideInvalid, setHideInvalid] = useState(true);
  const [trackedLapCount, setTrackedLapCount] = useState(0);

  const visibleLaps = hideInvalid ? laps.filter((l) => l.valid) : laps;
  const pageCount = Math.max(1, Math.ceil(visibleLaps.length / PAGE_SIZE));

  // Auto-advance to last page when new laps arrive (derived-state pattern, no effect needed).
  if (visibleLaps.length > trackedLapCount) {
    setTrackedLapCount(visibleLaps.length);
    setPage(pageCount);
  }

  // Close expanded row when changing page.
  const goToPage = (p: number) => {
    setPage(p);
    setExpandedId(null);
  };

  const toggleHideInvalid = () => {
    setHideInvalid((v) => !v);
    setPage(1);
    setExpandedId(null);
  };

  const pageLaps = visibleLaps.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggle = (id: number, valid: boolean) => {
    if (!valid) return;
    setExpandedId((cur) => (cur === id ? null : id));
  };

  return (
    <div>
      <div className="d-flex justify-content-end mb-1">
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
          </tr>
        </thead>
        <tbody>
          {laps.length === 0 && (
            <tr>
              <td colSpan={9} className="text-center text-muted">
                Nessun giro
              </td>
            </tr>
          )}
          {pageLaps.map((l) => {
            const expanded = expandedId === l.id;
            const clickable = !!l.valid;
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
                  <td style={{ color: "var(--text-dim)" }}>
                    {clickable && (
                      <FontAwesomeIcon
                        icon={faChevronRight}
                        style={{
                          transition: "transform 0.25s ease",
                          transform: expanded
                            ? "rotate(90deg)"
                            : "rotate(0deg)",
                          fontSize: 11,
                        }}
                      />
                    )}
                  </td>
                  <td>{l.lap_number}</td>
                  <td>{formatLapTime(l.lap_time)}</td>
                  <td>{l.sector1 != null ? formatLapTime(l.sector1) : "--"}</td>
                  <td>{l.sector2 != null ? formatLapTime(l.sector2) : "--"}</td>
                  <td>{l.sector3 != null ? formatLapTime(l.sector3) : "--"}</td>
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
                    {l.setup_id != null ? (
                      <Badge
                        bg="info"
                        style={{
                          maxWidth: 160,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          display: "inline-block",
                        }}
                        title={setupById.get(l.setup_id)}
                      >
                        {setupById.get(l.setup_id) ?? `#${l.setup_id}`}
                      </Badge>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>{new Date(l.recorded_at).toLocaleString("it-IT")}</td>
                </tr>
                <tr className="lap-telemetry-row">
                  <td
                    colSpan={9}
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
            <div className="sh-page-numbers d-flex gap-1">
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
    </div>
  );
};

export default LapsTable;
