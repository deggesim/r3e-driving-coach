import { useEffect, useState } from "react";
import { Badge, Button, Modal, Spinner } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCamera, faCheck } from "@fortawesome/free-solid-svg-icons";
import type { GameSource, SessionSetupRow, SetupData } from "../../shared/types";

interface Props {
  show: boolean;
  car: string;
  track: string;
  layout: string;
  game: GameSource;
  onClose: () => void;
  onSelectSetup: (setup: SetupData) => void;
  onScreenshotPicker: () => void;
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
  onSelectSetup,
  onScreenshotPicker,
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
            <div className="d-flex flex-column gap-2 mb-3">
              {history.map((row) => (
                <div
                  key={row.id}
                  className="d-flex align-items-center gap-2 p-2 rounded"
                  style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}
                >
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <div className="fw-semibold text-truncate" style={{ fontSize: 14 }}>
                      {row.setup.name ?? row.setup.carFound ?? `Setup #${row.id}`}
                    </div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {formatDate(row.loaded_at)}
                      {row.setup.carVerified && (
                        <Badge bg="success" className="ms-2" style={{ fontSize: 10 }}>
                          <FontAwesomeIcon icon={faCheck} className="me-1" />
                          verificato
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline-primary"
                    onClick={() => onSelectSetup(row.setup)}
                  >
                    Seleziona
                  </Button>
                </div>
              ))}
            </div>
            <hr style={{ borderColor: "var(--border)" }} />
          </>
        ) : (
          <p className="text-muted mb-3" style={{ fontSize: 13 }}>
            Nessun setup precedente trovato per questa combinazione auto/circuito.
          </p>
        )}

        <Button variant="outline-secondary" onClick={onScreenshotPicker} className="w-100">
          <FontAwesomeIcon icon={faCamera} className="me-2" />
          Carica dagli screenshot
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
