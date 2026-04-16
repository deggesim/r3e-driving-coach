/**
 * AceSetupPicker — modal to select a .carsetup file for ACE.
 * Lists files from D:\Salvataggi\ACE\Car Setups\{car}\{track}\
 * via IPC ace:listSetupFiles, then decodes the selected file via ace:readSetup.
 */

import { faCheck, faGear, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { Button, ListGroup, Modal, Spinner } from "react-bootstrap";
import type { SetupData } from "../../shared/types";

type SetupFileEntry = {
  filename: string;
  filePath: string;
  modifiedAt: string;
};

type Props = {
  show: boolean;
  car: string;
  track: string;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const AceSetupPicker = ({ show, car, track, onClose, onConfirm }: Props) => {
  const [files, setFiles] = useState<SetupFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!show || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    setError(null);
    window.electronAPI
      .aceListSetupFiles({ car, track })
      .then((list) => setFiles(list))
      .catch(() => setError("Impossibile leggere la cartella setup."))
      .finally(() => setLoading(false));
  }, [show, car, track]);

  const handleClose = (): void => {
    loadedRef.current = false;
    setFiles([]);
    setSelected(null);
    setError(null);
    onClose();
  };

  const handleConfirm = async (): Promise<void> => {
    if (!selected) return;
    setDecoding(true);
    setError(null);
    try {
      const setup = await window.electronAPI.aceReadSetup({ filePath: selected });
      onConfirm(setup);
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Errore nella decodifica del file.",
      );
    } finally {
      setDecoding(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>
          <FontAwesomeIcon icon={faGear} className="me-2" />
          Seleziona Setup ACE
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading && (
          <div className="d-flex justify-content-center py-4">
            <Spinner animation="border" size="sm" className="me-2" />
            <span>Caricamento file setup...</span>
          </div>
        )}

        {!loading && files.length === 0 && !error && (
          <div className="text-secondary text-center py-4">
            Nessun file .carsetup trovato per
            <br />
            <code>{car} / {track}</code>
          </div>
        )}

        {error && (
          <div className="text-danger text-center py-3">
            <FontAwesomeIcon icon={faXmark} className="me-1" />
            {error}
          </div>
        )}

        {!loading && files.length > 0 && (
          <ListGroup>
            {files.map((f) => (
              <ListGroup.Item
                key={f.filePath}
                action
                active={selected === f.filePath}
                onClick={() => setSelected(f.filePath)}
                className="d-flex justify-content-between align-items-center"
              >
                <span className="fw-medium">{f.filename}</span>
                <small className="text-secondary">{formatDate(f.modifiedAt)}</small>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={decoding}>
          <FontAwesomeIcon icon={faXmark} className="me-1" />
          Annulla
        </Button>
        <Button
          variant="primary"
          disabled={!selected || decoding}
          onClick={handleConfirm}
        >
          {decoding ? (
            <Spinner size="sm" className="me-1" />
          ) : (
            <FontAwesomeIcon icon={faCheck} className="me-1" />
          )}
          Carica Setup
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AceSetupPicker;
