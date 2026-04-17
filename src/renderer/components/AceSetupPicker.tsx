/**
 * AceSetupPicker — modal to select a .carsetup file for ACE.
 *
 * Step 1: choose car from D:\Salvataggi\ACE\Car Setups\ subdirs.
 * Step 2: choose track from {car}\ subdirs.
 * Step 3: choose .carsetup file.
 *
 * Validation badge warns when the selected car/track doesn't match the
 * expectedCar/expectedTrack supplied by the caller (lap row or live session).
 */

import { faCheck, faGear, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Form, ListGroup, Modal, Spinner } from "react-bootstrap";
import type { SetupData } from "../../shared/types";

type SetupFileEntry = {
  filename: string;
  filePath: string;
  modifiedAt: string;
};

type Props = {
  show: boolean;
  expectedCar: string;
  expectedTrack: string;
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

const AceSetupPicker = ({ show, expectedCar, expectedTrack, onClose, onConfirm }: Props) => {
  const [cars, setCars] = useState<string[]>([]);
  const [tracks, setTracks] = useState<string[]>([]);
  const [files, setFiles] = useState<SetupFileEntry[]>([]);

  const [selectedCar, setSelectedCar] = useState(expectedCar);
  const [selectedTrack, setSelectedTrack] = useState(expectedTrack);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const [loadingCars, setLoadingCars] = useState(false);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initializedRef = useRef(false);

  // Load car list when modal opens
  useEffect(() => {
    if (!show || initializedRef.current) return;
    initializedRef.current = true;
    setLoadingCars(true);
    setError(null);
    window.electronAPI
      .aceListSetupCars()
      .then((list) => {
        setCars(list);
        // Pre-select expectedCar if present; otherwise first item
        const pre = list.includes(expectedCar) ? expectedCar : (list[0] ?? "");
        setSelectedCar(pre);
      })
      .catch(() => setError("Impossibile leggere la cartella Car Setups."))
      .finally(() => setLoadingCars(false));
  }, [show, expectedCar]);

  // Load track list when selectedCar changes
  useEffect(() => {
    if (!selectedCar) return;
    setTracks([]);
    setFiles([]);
    setSelectedFile(null);
    setLoadingTracks(true);
    window.electronAPI
      .aceListSetupTracks({ car: selectedCar })
      .then((list) => {
        setTracks(list);
        const pre = list.includes(selectedTrack) ? selectedTrack : (list[0] ?? "");
        setSelectedTrack(pre);
      })
      .catch(() => setError("Impossibile leggere le tracce per questo veicolo."))
      .finally(() => setLoadingTracks(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCar]);

  // Load file list when selectedTrack changes
  useEffect(() => {
    if (!selectedCar || !selectedTrack) return;
    setFiles([]);
    setSelectedFile(null);
    setLoadingFiles(true);
    window.electronAPI
      .aceListSetupFiles({ car: selectedCar, track: selectedTrack })
      .then((list) => setFiles(list))
      .catch(() => setError("Impossibile leggere i file setup."))
      .finally(() => setLoadingFiles(false));
  }, [selectedCar, selectedTrack]);

  const handleClose = (): void => {
    initializedRef.current = false;
    setCars([]);
    setTracks([]);
    setFiles([]);
    setSelectedCar(expectedCar);
    setSelectedTrack(expectedTrack);
    setSelectedFile(null);
    setError(null);
    onClose();
  };

  const handleConfirm = async (): Promise<void> => {
    if (!selectedFile) return;
    setDecoding(true);
    setError(null);
    try {
      const setup = await window.electronAPI.aceReadSetup({ filePath: selectedFile });
      onConfirm(setup);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore nella decodifica del file.");
    } finally {
      setDecoding(false);
    }
  };

  const mismatch =
    (selectedCar && expectedCar && selectedCar !== expectedCar) ||
    (selectedTrack && expectedTrack && selectedTrack !== expectedTrack);

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>
          <FontAwesomeIcon icon={faGear} className="me-2" />
          Seleziona Setup ACE
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && (
          <div className="text-danger mb-3">
            <FontAwesomeIcon icon={faXmark} className="me-1" />
            {error}
          </div>
        )}

        {/* Car / Track selectors */}
        <div className="d-flex gap-3 mb-3 align-items-end">
          <Form.Group style={{ flex: 1 }}>
            <Form.Label className="small mb-1">Vettura</Form.Label>
            {loadingCars ? (
              <div className="d-flex align-items-center gap-2">
                <Spinner size="sm" /> <span className="small">Caricamento...</span>
              </div>
            ) : (
              <Form.Select
                size="sm"
                value={selectedCar}
                onChange={(e) => setSelectedCar(e.target.value)}
              >
                {cars.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Form.Select>
            )}
          </Form.Group>

          <Form.Group style={{ flex: 1 }}>
            <Form.Label className="small mb-1">Circuito</Form.Label>
            {loadingTracks ? (
              <div className="d-flex align-items-center gap-2">
                <Spinner size="sm" /> <span className="small">Caricamento...</span>
              </div>
            ) : (
              <Form.Select
                size="sm"
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(e.target.value)}
                disabled={tracks.length === 0}
              >
                {tracks.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Form.Select>
            )}
          </Form.Group>

          {/* Validation badge */}
          <div style={{ minWidth: 140 }}>
            {mismatch ? (
              <Badge bg="warning" text="dark" className="d-flex align-items-center gap-1" style={{ fontSize: 11 }}>
                <FontAwesomeIcon icon={faTriangleExclamation} />
                Diverso dal giro selezionato
              </Badge>
            ) : selectedCar && selectedTrack ? (
              <Badge bg="success" className="d-flex align-items-center gap-1" style={{ fontSize: 11 }}>
                <FontAwesomeIcon icon={faCheck} />
                Auto/circuito corretti
              </Badge>
            ) : null}
          </div>
        </div>

        {/* File list */}
        {loadingFiles && (
          <div className="d-flex justify-content-center py-3">
            <Spinner size="sm" className="me-2" />
            <span>Caricamento file setup...</span>
          </div>
        )}

        {!loadingFiles && files.length === 0 && selectedCar && selectedTrack && (
          <div className="text-secondary text-center py-3">
            Nessun file .carsetup trovato per
            <br />
            <code>{selectedCar} / {selectedTrack}</code>
          </div>
        )}

        {!loadingFiles && files.length > 0 && (
          <ListGroup>
            {files.map((f) => (
              <ListGroup.Item
                key={f.filePath}
                action
                active={selectedFile === f.filePath}
                onClick={() => setSelectedFile(f.filePath)}
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
          disabled={!selectedFile || decoding}
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
