/**
 * SessionHistory — Paginated list of past sessions (R3E + ACE).
 * Columns: Simulator / Car / Track / Date. 10 rows per page.
 * Filters: game / car / track. Sort: started_at asc|desc.
 * Row click → shows SessionDetail inline (back button returns to list).
 */

import {
  faArrowDownWideShort,
  faArrowUpWideShort,
  faFlask,
  faRobot,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Form, Modal, Spinner } from "react-bootstrap";
import type { GameSource, SessionRow } from "../../shared/types";
import { formatLapTime } from "../../shared/format";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { MOCK_SESSIONS, MOCK_DETAILS } from "../mocks/mockData";
import SessionDetail from "./SessionDetail";

const PAGE_SIZE = 10;
const FETCH_SIZE = 500; // upper bound — load all, paginate/filter client-side

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

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(normalized).toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const SessionHistory = () => {
  const loadById = useSessionStore((s) => s.loadById);
  const setDetail = useSessionStore((s) => s.setDetail);
  const mockHistoryMode = useSettingsStore((s) => s.mockHistoryMode);

  const [view, setView] = useState<"list" | "detail">("list");

  const [allSessions, setAllSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filterGame, setFilterGame] = useState<"" | GameSource>("");
  const [filterCar, setFilterCar] = useState("");
  const [filterTrack, setFilterTrack] = useState("");
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  type DeleteTarget = { type: "single"; session: SessionRow } | { type: "all" };
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const loadSessions = (): void => {
    if (!window.electronAPI) return;
    setLoading(true);
    window.electronAPI
      .sessionList({ page: 0, pageSize: FETCH_SIZE, sort: "desc" })
      .then((res) => {
        setAllSessions(res.items);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filterGame, filterCar, filterTrack, sort]);

  const visibleSessions = useMemo(
    () => (mockHistoryMode ? [...MOCK_SESSIONS, ...allSessions] : allSessions),
    [allSessions, mockHistoryMode],
  );

  const gameSessions = useMemo(
    () =>
      filterGame
        ? visibleSessions.filter((s) => s.game === filterGame)
        : visibleSessions,
    [visibleSessions, filterGame],
  );

  const carOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of gameSessions) {
      if (!seen.has(s.car)) {
        const label = s.car_class_name
          ? `${s.car_name ?? s.car} (${s.car_class_name})`
          : (s.car_name ?? s.car);
        seen.set(s.car, label);
      }
    }
    return Array.from(seen.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [gameSessions]);

  const trackOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of gameSessions) {
      const key = `${s.track}|${s.layout}`;
      if (!seen.has(key)) {
        seen.set(
          key,
          `${s.track_name ?? s.track} (${s.layout_name ?? s.layout})`,
        );
      }
    }
    return Array.from(seen.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [gameSessions]);

  const filtered = useMemo(() => {
    let result = gameSessions;
    if (filterCar) result = result.filter((s) => s.car === filterCar);
    if (filterTrack) {
      const [t, l] = filterTrack.split("|");
      result = result.filter((s) => s.track === t && s.layout === l);
    }
    const mul = sort === "asc" ? 1 : -1;
    return [...result].sort(
      (a, b) => mul * a.started_at.localeCompare(b.started_at),
    );
  }, [gameSessions, filterCar, filterTrack, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleRowClick = (s: SessionRow): void => {
    if (s.id < 0) {
      setDetail(MOCK_DETAILS[s.id] ?? null, "historical");
    } else {
      void loadById(s.id, s.game);
    }
    setView("detail");
  };

  const executeDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "single") {
      const { session } = deleteTarget;
      await window.electronAPI.sessionDelete({
        id: session.id,
        game: session.game,
      });
      setAllSessions((prev) =>
        prev.filter((s) => !(s.id === session.id && s.game === session.game)),
      );
    } else {
      const items = filtered
        .filter((s) => s.id >= 0)
        .map((s) => ({ id: s.id, game: s.game }));
      await window.electronAPI.sessionDeleteAll(items);
      const keys = new Set(items.map(({ id, game }) => `${game}-${id}`));
      setAllSessions((prev) =>
        prev.filter((s) => !keys.has(`${s.game}-${s.id}`)),
      );
    }
    setDeleteTarget(null);
  };

  if (view === "detail") {
    return <SessionDetail onBack={() => setView("list")} />;
  }

  return (
    <div className="session-history h-100 d-flex flex-column overflow-hidden">
      <div className="px-3 pt-3 pb-2 flex-shrink-0 d-flex align-items-center gap-2">
        <span className="sh-title">Elenco sessioni</span>
        {loading && <Spinner size="sm" variant="danger" />}
      </div>

      <div className="sh-filter-bar flex-shrink-0">
        <Form.Select
          size="sm"
          className="sh-filter-select"
          value={filterGame}
          onChange={(e) => setFilterGame(e.target.value as "" | GameSource)}
          style={{ maxWidth: 120 }}
        >
          <option value="">Tutti i giochi</option>
          <option value="r3e">RaceRoom</option>
          <option value="ace">AC Evo</option>
        </Form.Select>

        <Form.Select
          size="sm"
          className="sh-filter-select"
          value={filterCar}
          onChange={(e) => setFilterCar(e.target.value)}
          style={{ maxWidth: 260 }}
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

        <Button
          variant="outline-secondary"
          size="sm"
          className="sh-filter-select ms-auto d-flex align-items-center gap-1"
          onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))}
          title={sort === "desc" ? "Data decrescente" : "Data crescente"}
        >
          <FontAwesomeIcon
            icon={sort === "desc" ? faArrowDownWideShort : faArrowUpWideShort}
          />
          Data
        </Button>

        {filtered.length > 0 && (
          <Button
            variant="outline-danger"
            size="sm"
            className="sh-filter-select"
            onClick={() => setDeleteTarget({ type: "all" })}
          >
            <FontAwesomeIcon icon={faTrash} className="me-1" />
            Elimina tutti
          </Button>
        )}
      </div>

      <div className="overflow-y-auto flex-grow-1 px-3">
        {!loading && filtered.length === 0 ? (
          <p className="text-secondary py-2 mb-0">
            Nessuna sessione registrata.
          </p>
        ) : (
          <table className="sh-table w-100">
            <thead>
              <tr>
                <th>Sim</th>
                <th>Auto</th>
                <th>Circuito</th>
                <th>Giri</th>
                <th>Best</th>
                <th>Data</th>
                <th>Analisi</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((s) => (
                <tr
                  key={`${s.game}-${s.id}`}
                  className="sh-row"
                  onClick={() => handleRowClick(s)}
                >
                  <td>
                    <Badge
                      bg={s.game === "ace" ? "info" : "secondary"}
                      style={{ fontSize: 12 }}
                    >
                      {s.game === "ace" ? "ACE" : "R3E"}
                    </Badge>
                    {s.id < 0 && (
                      <Badge
                        bg="warning"
                        text="dark"
                        className="ms-1"
                        style={{ fontSize: 12 }}
                      >
                        <FontAwesomeIcon icon={faFlask} className="me-1" />
                        mock
                      </Badge>
                    )}
                  </td>
                  <td>
                    {s.car_name ?? s.car}
                    {s.car_class_name && (
                      <span
                        className="text-secondary ms-1"
                        style={{ fontSize: 12 }}
                      >
                        ({s.car_class_name})
                      </span>
                    )}
                  </td>
                  <td>
                    {s.track_name ?? s.track}
                    {s.layout_name && s.layout_name !== s.track_name && (
                      <span
                        className="text-secondary ms-1"
                        style={{ fontSize: 12 }}
                      >
                        — {s.layout_name}
                      </span>
                    )}
                  </td>
                  <td>{s.lap_count}</td>
                  <td className="sh-laptime">
                    {s.best_lap != null ? formatLapTime(s.best_lap) : "—"}
                  </td>
                  <td className="sh-date">{formatDate(s.started_at)}</td>
                  <td>
                    {s.analysis_count != null && s.analysis_count > 0 && (
                      <Badge bg="primary" style={{ fontSize: 12 }}>
                        <FontAwesomeIcon icon={faRobot} className="me-1" />
                        {s.analysis_count}
                      </Badge>
                    )}
                  </td>
                  <td
                    className="sh-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {s.id >= 0 && (
                      <Button
                        variant="link"
                        size="sm"
                        className="sh-del-btn"
                        onClick={() =>
                          setDeleteTarget({ type: "single", session: s })
                        }
                        aria-label="Elimina sessione"
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="sh-pagination d-flex align-items-center gap-2 px-3 py-2">
          <span
            className="sh-page-count text-secondary"
            style={{ fontSize: 12, whiteSpace: "nowrap" }}
          >
            {filtered.length === 0
              ? "0 sessioni"
              : `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, filtered.length)} di ${filtered.length}`}
          </span>
          {totalPages > 1 && (
            <>
              <Button
                variant="link"
                size="sm"
                className="sh-page-btn ms-auto"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ‹ Prec
              </Button>
              <div className="sh-page-numbers d-flex gap-1">
                {buildPageWindow(page, totalPages).map((entry, i, arr) =>
                  entry === "…" ? (
                    <span
                      key={`ellipsis-${arr[i - 1] ?? 0}-${arr[i + 1] ?? 0}`}
                      className="sh-page-ellipsis"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={entry}
                      className={`sh-page-num ${entry === page ? "active" : ""}`}
                      onClick={() => setPage(entry as number)}
                      type="button"
                    >
                      {entry}
                    </button>
                  ),
                )}
              </div>
              <Button
                variant="link"
                size="sm"
                className="sh-page-btn"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Succ ›
              </Button>
            </>
          )}
        </div>
      </div>

      <Modal
        show={deleteTarget !== null}
        onHide={() => setDeleteTarget(null)}
        centered
        size="sm"
        className="delete-confirm-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 16 }}>
            Conferma eliminazione
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {deleteTarget?.type === "single" ? (
            <p className="mb-0">
              Stai per eliminare la sessione del{" "}
              {formatDate(deleteTarget.session.started_at)} (
              {deleteTarget.session.car_name ?? deleteTarget.session.car} —{" "}
              {deleteTarget.session.track_name ?? deleteTarget.session.track}).
              <br />
              <span className="text-danger">L'operazione è irreversibile.</span>
            </p>
          ) : (
            <p className="mb-0">
              Stai per eliminare{" "}
              <strong>tutte le {filtered.length} sessioni</strong> della
              selezione corrente.
              <br />
              <span className="text-danger">L'operazione è irreversibile.</span>
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDeleteTarget(null)}
          >
            Annulla
          </Button>
          <Button variant="danger" size="sm" onClick={executeDelete}>
            Conferma
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default SessionHistory;
