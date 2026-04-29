import { useEffect, useState } from "react";
import { Accordion, Badge, Button, Modal, Spinner } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faFileCode } from "@fortawesome/free-solid-svg-icons";
import type { GameSource, SessionSetupRow } from "../../shared/types";

interface Props {
  show: boolean;
  car: string;
  track: string;
  layout: string;
  game: GameSource;
  onClose: () => void;
  onReuseSetup: (setupId: number) => void;
  onJsonPicker: () => void;
}

const formatDate = (iso: string): string => {
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

const SetupSelectionModal = ({
  show,
  car,
  track,
  layout,
  game,
  onClose,
  onReuseSetup,
  onJsonPicker,
}: Props) => {
  const [history, setHistory] = useState<SessionSetupRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!show || !car || !track) return;
    setLoading(true);
    window.electronAPI
      .sessionGetSetupHistory({ car, track, layout, game })
      .then((rows) => {
        // Deduplicate by setup name; keep most recent per name
        const seen = new Map<string, SessionSetupRow>();
        for (const row of rows) {
          const key = row.setup.name ?? row.setup.carFound ?? String(row.id);
          if (!seen.has(key)) seen.set(key, row);
        }
        setHistory(Array.from(seen.values()));
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [show, car, track, layout, game]);

  return (
    <Modal
      show={show}
      onHide={onClose}
      centered
      size="lg"
      className="setup-selection-modal"
    >
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: 16 }}>Carica setup</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {loading ? (
          <div className="text-center py-3">
            <Spinner size="sm" className="me-2" />
            Caricamento setup precedenti…
          </div>
        ) : history.length > 0 ? (
          <>
            <p className="text-muted mb-2" style={{ fontSize: 13 }}>
              Setup già caricati per questa combinazione auto/circuito:
            </p>
            <Accordion className="setup-history-accordion mb-3" flush>
              {history.map((row) => {
                const displayName =
                  row.setup.name ?? row.setup.carFound ?? `Setup #${row.id}`;
                const hasParams = row.setup.params && row.setup.params.length > 0;

                return (
                  <Accordion.Item eventKey={String(row.id)} key={row.id}>
                    <Accordion.Header>
                      <div className="setup-acc-header">
                        <span className="setup-acc-name">{displayName}</span>
                        <span className="setup-acc-meta">
                          {formatDate(row.loaded_at)}
                          {row.setup.carVerified && (
                            <Badge bg="success" className="ms-2" style={{ fontSize: 10 }}>
                              <FontAwesomeIcon icon={faCheck} className="me-1" />
                              verificato
                            </Badge>
                          )}
                        </span>
                      </div>
                    </Accordion.Header>
                    <Accordion.Body>
                      {hasParams ? (
                        <table className="setup-table w-100 mb-3">
                          <thead>
                            <tr>
                              <th>Categoria</th>
                              <th>Parametro</th>
                              <th>Valore</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.setup.params.map((p) => (
                              <tr key={`${p.category}__${p.parameter}`}>
                                <td className="text-dim">{p.category}</td>
                                <td>{p.parameter}</td>
                                <td className="setup-value">{p.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-muted mb-3" style={{ fontSize: 13 }}>
                          Nessun parametro decodificato per questo setup.
                        </p>
                      )}
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={() => onReuseSetup(row.id)}
                      >
                        <FontAwesomeIcon icon={faCheck} className="me-1" />
                        Usa questo setup
                      </Button>
                    </Accordion.Body>
                  </Accordion.Item>
                );
              })}
            </Accordion>
            <hr style={{ borderColor: "var(--border)" }} />
          </>
        ) : (
          <p className="text-muted mb-3" style={{ fontSize: 13 }}>
            Nessun setup precedente trovato per questa combinazione auto/circuito.
          </p>
        )}

        <Button variant="outline-secondary" onClick={onJsonPicker} className="w-100">
          <FontAwesomeIcon icon={faFileCode} className="me-2" />
          Carica da JSON
        </Button>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Chiudi
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default SetupSelectionModal;
