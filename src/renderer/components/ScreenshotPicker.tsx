/**
 * ScreenshotPicker — modal to select Steam screenshots for setup decoding.
 * Shows thumbnails, allows multi-select, then triggers Claude Vision decode.
 */

import { faCheck, faCircleNotch, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Modal, Spinner } from "react-bootstrap";
import type { SetupData } from "../../shared/types";

type ScreenshotEntry = { name: string; thumbnailB64: string };

type Props = {
  show: boolean;
  expectedCar: string;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

type Phase = "pick" | "decoding" | "verify";

const ScreenshotPicker = ({ show, expectedCar, onClose, onConfirm }: Props) => {
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("pick");
  const [decodedSetup, setDecodedSetup] = useState<SetupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!show || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    window.electronAPI
      .listScreenshots()
      .then((list) => {
        setScreenshots(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [show]);

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDecode = async (): Promise<void> => {
    if (selected.size === 0) return;
    setPhase("decoding");
    setError(null);
    try {
      const result = await window.electronAPI.decodeSetup({
        filenames: Array.from(selected),
        expectedCar,
      });
      setDecodedSetup(result);
      setPhase("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore durante il decoding");
      setPhase("pick");
    }
  };

  const handleConfirm = (): void => {
    if (decodedSetup) onConfirm(decodedSetup);
  };

  const handleClose = (): void => {
    setPhase("pick");
    setSelected(new Set());
    setDecodedSetup(null);
    setError(null);
    onClose();
  };

  return (
    <Modal show={show} onHide={handleClose} size="xl" className="screenshot-picker-modal">
      <Modal.Header className="picker-header">
        <Modal.Title className="picker-title">
          Seleziona screenshot setup
          <span className="picker-subtitle"> · {expectedCar}</span>
        </Modal.Title>
        <Button variant="link" className="picker-close" onClick={handleClose}>
          <FontAwesomeIcon icon={faXmark} />
        </Button>
      </Modal.Header>

      <Modal.Body className="picker-body">
        {phase === "pick" && (
          <>
            {error && <div className="picker-error mb-3">{error}</div>}
            {loading ? (
              <div className="picker-loading">
                <Spinner size="sm" variant="danger" /> Caricamento screenshot...
              </div>
            ) : screenshots.length === 0 ? (
              <p className="text-secondary">Nessuno screenshot trovato nella cartella Steam.</p>
            ) : (
              <div className="picker-grid">
                {screenshots.map((s) => (
                  <div
                    key={s.name}
                    className={`picker-thumb ${selected.has(s.name) ? "selected" : ""}`}
                    onClick={() => toggle(s.name)}
                  >
                    <img
                      src={`data:image/jpeg;base64,${s.thumbnailB64}`}
                      alt={s.name}
                      className="picker-img"
                    />
                    {selected.has(s.name) && (
                      <div className="picker-check">
                        <FontAwesomeIcon icon={faCheck} />
                      </div>
                    )}
                    <div className="picker-name">{s.name.replace(/_1\.jpg$/, "")}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {phase === "decoding" && (
          <div className="picker-loading">
            <FontAwesomeIcon icon={faCircleNotch} spin />
            <span>Analisi setup in corso con Claude Vision...</span>
          </div>
        )}

        {phase === "verify" && decodedSetup && (
          <div className="picker-verify">
            <div className="picker-car-check mb-3">
              {decodedSetup.carVerified ? (
                <Badge bg="success">
                  <FontAwesomeIcon icon={faCheck} className="me-1" />
                  Auto verificata: {decodedSetup.carFound}
                </Badge>
              ) : (
                <Badge bg="warning" text="dark">
                  Attenzione: auto rilevata "{decodedSetup.carFound}" — potrebbe non corrispondere a "{expectedCar}"
                </Badge>
              )}
            </div>

            {decodedSetup.params.length > 0 && (
              <div className="picker-params">
                <table className="setup-table w-100">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Parametro</th>
                      <th>Valore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decodedSetup.params.map((p, i) => (
                      <tr key={i}>
                        <td className="text-dim">{p.category}</td>
                        <td>{p.parameter}</td>
                        <td className="setup-value">{p.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal.Body>

      <Modal.Footer className="picker-footer">
        {phase === "pick" && (
          <>
            <span className="text-secondary me-auto">
              {selected.size > 0 ? `${selected.size} screenshot selezionati` : "Seleziona le schermate del setup"}
            </span>
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Annulla
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={selected.size === 0}
              onClick={handleDecode}
            >
              Decodifica setup
            </Button>
          </>
        )}

        {phase === "verify" && decodedSetup && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setPhase("pick")}>
              ← Riseleziona
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirm}
            >
              <FontAwesomeIcon icon={faCheck} className="me-1" />
              Salva setup
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default ScreenshotPicker;
