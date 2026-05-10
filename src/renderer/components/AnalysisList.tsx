import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { marked } from "marked";
import { use, useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionContext,
  Button,
  Modal,
  Spinner,
  useAccordionButton,
} from "react-bootstrap";
import { useSessionStore } from "../store/sessionStore";

type StreamingVersion = { sessionId: number; version: number; text: string };
type PendingDelete = { id: number; version: number };

const AnalysisAccordionHeader = ({
  eventKey,
  version,
  createdAt,
  onDelete,
}: {
  eventKey: string;
  version: number;
  createdAt: string;
  onDelete: (e: React.MouseEvent) => void;
}) => {
  const { activeEventKey } = use(AccordionContext);
  const handleToggle = useAccordionButton(eventKey);
  const isOpen = Array.isArray(activeEventKey)
    ? activeEventKey.includes(eventKey)
    : activeEventKey === eventKey;

  return (
    <h2 className="accordion-header d-flex align-items-stretch">
      <button
        type="button"
        className="btn btn-link btn-sm text-danger accordion-button-delete p-0 px-3"
        title="Elimina analisi"
        onClick={onDelete}
        style={{ lineHeight: 1 }}
      >
        <FontAwesomeIcon icon={faTrash} />
      </button>
      <button
        type="button"
        className={`accordion-button flex-grow-1${isOpen ? "" : " collapsed"}`}
        onClick={handleToggle}
      >
        <span className="flex-grow-1">
          Analisi #{version}
          <span className="ms-2">
            {new Date(createdAt).toLocaleString("it-IT")}
          </span>
        </span>
      </button>
    </h2>
  );
};

type Props = {
  streamingVersion: StreamingVersion | null;
  startClosed?: boolean;
};

const renderMd = (md: string): string =>
  marked.parse(md, { async: false }) as string;

const AnalysisList = ({ streamingVersion, startClosed = false }: Props) => {
  const analyses = useSessionStore((s) => s.analyses);
  const deleteAnalysis = useSessionStore((s) => s.deleteAnalysis);

  const renderedAnalyses = useMemo(
    () => analyses.map((a) => ({ id: a.id, html: renderMd(a.template_v3) })),
    [analyses],
  );
  const renderedById = useMemo(
    () => new Map(renderedAnalyses.map((r) => [r.id, r.html])),
    [renderedAnalyses],
  );

  const [activeKeys, setActiveKeys] = useState<string[]>(() => {
    if (startClosed || analyses.length === 0) return [];
    return [`v${analyses[analyses.length - 1].version}`];
  });
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );

  // Open the streaming accordion as soon as a new streaming version starts.
  useEffect(() => {
    if (!streamingVersion) return;
    const key = `streaming-${streamingVersion.version}`;
    setActiveKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, [streamingVersion]);

  // Open the completed accordion when streaming finishes (new analysis landed).
  // Using a ref to track previous analyses avoids the React 18 batching issue where
  // streaming→null and analyses update land in the same render, never letting us observe
  // the streaming→non-null state in an effect.
  const prevAnalysesRef = useRef(analyses);
  useEffect(() => {
    const prev = prevAnalysesRef.current;
    prevAnalysesRef.current = analyses;

    if (streamingVersion) return; // still in progress — don't open yet

    const newAnalysis = analyses.find((a) => !prev.some((p) => p.id === a.id));
    if (newAnalysis) {
      const key = `v${newAnalysis.version}`;
      setActiveKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    }
  }, [analyses, streamingVersion]);

  const handleDeleteClick = (
    e: React.MouseEvent,
    id: number,
    version: number,
  ) => {
    e.stopPropagation();
    setPendingDelete({ id, version });
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    const { id, version } = pendingDelete;
    setPendingDelete(null);
    await deleteAnalysis(id);
    setActiveKeys((prev) => prev.filter((k) => k !== `v${version}`));
  };

  return (
    <>
      <Accordion
        activeKey={activeKeys}
        onSelect={(keys) => {
          if (Array.isArray(keys)) setActiveKeys(keys);
          else if (typeof keys === "string") setActiveKeys([keys]);
          else setActiveKeys([]);
        }}
        className="analysis-accordion"
      >
        {analyses.map((a) => (
          <Accordion.Item key={a.id} eventKey={`v${a.version}`}>
            <AnalysisAccordionHeader
              eventKey={`v${a.version}`}
              version={a.version}
              createdAt={a.created_at}
              onDelete={(e) => handleDeleteClick(e, a.id, a.version)}
            />
            <Accordion.Body className="overflow-y-auto">
              <div
                className="deb-content"
                // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                dangerouslySetInnerHTML={{ __html: renderedById.get(a.id) ?? "" }}
              />
            </Accordion.Body>
          </Accordion.Item>
        ))}
        {streamingVersion && (
          <Accordion.Item eventKey={`streaming-${streamingVersion.version}`}>
            <Accordion.Header>
              <Spinner size="sm" className="me-2" />
              Analisi #{streamingVersion.version} (in corso…)
            </Accordion.Header>
            <Accordion.Body className="overflow-y-auto">
              <div
                className="deb-content"
                // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                dangerouslySetInnerHTML={{
                  __html: renderMd(streamingVersion.text),
                }}
              />
            </Accordion.Body>
          </Accordion.Item>
        )}
      </Accordion>

      <Modal
        show={pendingDelete !== null}
        onHide={() => setPendingDelete(null)}
        centered
        className="delete-confirm-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>Elimina analisi</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Eliminare l&apos;analisi #{pendingDelete?.version}? L&apos;operazione
          è irreversibile.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setPendingDelete(null)}>
            Annulla
          </Button>
          <Button variant="danger" onClick={handleDeleteConfirm}>
            Elimina
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AnalysisList;
