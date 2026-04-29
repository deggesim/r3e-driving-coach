/**
 * ScreenshotPicker — modal to select Steam screenshots for setup decoding.
 * Shows thumbnails, allows multi-select, then triggers Claude Vision decode.
 * Warns the user if a selected screenshot was already used in a previous setup.
 */

import { faArrowLeft, faCheck, faCircleNotch, faExclamationTriangle, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Form, Modal, Spinner } from "react-bootstrap";
import type { SetupData } from "../../shared/types";

type AlreadyUsedInfo = { setupName: string; loadedAt: string; sessionId: number };
type ScreenshotEntry = { name: string; thumbnailB64: string; alreadyUsed?: AlreadyUsedInfo };

type Props = {
  show: boolean;
  expectedCar: string;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

type Phase = "pick" | "confirm-duplicates" | "decoding" | "verify";

const ScreenshotPicker = ({ show, expectedCar, onClose, onConfirm }: Props) => {
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("pick");
  const [decodedSetup, setDecodedSetup] = useState<SetupData | null>(null);
  const [setupName, setSetupName] = useState("");
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

  const screenshotMap = new Map(screenshots.map((s) => [s.name, s]));

  const selectedDuplicates = Array.from(selected).filter(
    (name) => screenshotMap.get(name)?.alreadyUsed !== undefined,
  );

  const handleDecodeRequest = (): void => {
    if (selected.size === 0) return;
    if (selectedDuplicates.length > 0) {
      setPhase("confirm-duplicates");
    } else {
      void startDecode();
    }
  };

  const startDecode = async (): Promise<void> => {
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
    if (decodedSetup && setupName.trim()) {
      onConfirm({ ...decodedSetup, name: setupName.trim() });
    }
  };

  const handleClose = (): void => {
    setPhase("pick");
    setSelected(new Set());
    setDecodedSetup(null);
    setSetupName("");
    setError(null);
    onClose();
  };

  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return iso;
    }
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
                    className={`picker-thumb ${selected.has(s.name) ? "selected" : ""} ${s.alreadyUsed ? "already-used" : ""}`}
                    onClick={() => toggle(s.name)}
                    title={
                      s.alreadyUsed
                        ? `Già usato nel setup "${s.alreadyUsed.setupName || "senza nome"}" (${formatDate(s.alreadyUsed.loadedAt)})`
                        : undefined
                    }
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
                    {s.alreadyUsed && (
                      <div className="picker-used-badge">
                        <FontAwesomeIcon icon={faExclamationTriangle} className="me-1" />
                        Già scansionato
                      </div>
                    )}
                    <div className="picker-name">{s.name.replace(/_1\.jpg$/, "")}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {phase === "confirm-duplicates" && (
          <div className="picker-confirm">
            <div className="picker-confirm-icon">
              <FontAwesomeIcon icon={faExclamationTriangle} />
            </div>
            <h6 className="picker-confirm-title">Screenshot già scansionati</h6>
            <p className="picker-confirm-text">
              {selectedDuplicates.length === 1
                ? "1 screenshot selezionato è già presente in un setup precedente:"
                : `${selectedDuplicates.length} screenshot selezionati sono già presenti in setup precedenti:`}
            </p>
            <ul className="picker-confirm-list">
              {selectedDuplicates.map((name) => {
                const info = screenshotMap.get(name)!.alreadyUsed!;
                return (
                  <li key={name}>
                    <span className="picker-confirm-filename">{name.replace(/_1\.jpg$/, "")}</span>
                    {" — "}
                    <span className="text-dim">
                      setup "{info.setupName || "senza nome"}" del {formatDate(info.loadedAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="picker-confirm-question">Vuoi procedere comunque con il decode?</p>
          </div>
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

            <Form.Group className="mb-3" style={{ maxWidth: 360 }}>
              <Form.Label className="text-dim" style={{ fontSize: 13 }}>
                Nome setup <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                size="sm"
                type="text"
                placeholder="es. Qualifica Monza baseline"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                autoFocus
              />
            </Form.Group>

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
              {selected.size > 0
                ? `${selected.size} screenshot selezionati${selectedDuplicates.length > 0 ? ` (${selectedDuplicates.length} già scansionati)` : ""}`
                : "Seleziona le schermate del setup"}
            </span>
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Annulla
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={selected.size === 0}
              onClick={handleDecodeRequest}
            >
              Decodifica setup
            </Button>
          </>
        )}

        {phase === "confirm-duplicates" && (
          <>
            <Button variant="secondary" size="sm" onClick={() => setPhase("pick")}>
              <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
              Torna alla selezione
            </Button>
            <Button variant="danger" size="sm" onClick={() => void startDecode()}>
              Procedi comunque
            </Button>
          </>
        )}

        {phase === "verify" && decodedSetup && (
          <>
            <Button variant="secondary" size="sm" onClick={() => { setPhase("pick"); setSetupName(""); }}>
              <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
              Riseleziona
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!setupName.trim()}
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
