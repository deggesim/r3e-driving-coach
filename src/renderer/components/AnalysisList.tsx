import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { marked } from "marked";
import {
  use,
  useActionState,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";
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
type PendingDelete = { id: number; version: number } | null;

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
    <h2 className="accordion-header dark-header d-flex align-items-stretch">
      <button
        type="button"
        className="btn btn-link btn-sm text-danger p-0 px-3"
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

  // User-controlled open key (persisted across streaming transitions).
  // Streaming key is NOT stored here — it's computed at render time (see effectiveActiveKey).
  const [userActiveKey, setUserActiveKey] = useState<string | null>(() => {
    if (startClosed || analyses.length === 0) return null;
    return `v${analyses[analyses.length - 1].version}`;
  });

  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  // Track the last known streaming version number so we know which completed
  // accordion panel to open when streaming finishes.
  const lastStreamingVersionRef = useRef<number | null>(
    streamingVersion?.version ?? null,
  );

  // When streaming transitions from active → null, open the completed panel.
  // We only need to track the version number (no analyses array comparison needed).
  useEffect(() => {
    const prev = lastStreamingVersionRef.current;
    lastStreamingVersionRef.current = streamingVersion?.version ?? null;

    if (streamingVersion !== null || prev === null) return;

    // Streaming just finished for version `prev` — open its completed accordion key.
    setUserActiveKey(`v${prev}`);
  }, [streamingVersion]);

  // Merge user-controlled key with the streaming key (derived, never stored in state).
  // Streaming panel takes priority while active; otherwise use the user-selected key.
  const effectiveActiveKey = useMemo<string | null>(() => {
    if (!streamingVersion) return userActiveKey;
    return `streaming-${streamingVersion.version}`;
  }, [userActiveKey, streamingVersion]);

  // useActionState for delete: manages async lifecycle (pending state for free)
  // and keeps the action co-located with the confirmation UI.
  const [, deleteAction, isDeleting] = useActionState(
    async (_prev: null, payload: PendingDelete): Promise<null> => {
      if (!payload) return null;
      await deleteAnalysis(payload.id);
      setUserActiveKey((k) => (k === `v${payload.version}` ? null : k));
      return null;
    },
    null,
  );

  const handleDeleteClick = (
    e: React.MouseEvent,
    id: number,
    version: number,
  ) => {
    e.stopPropagation();
    setPendingDelete({ id, version });
  };

  const handleDeleteConfirm = () => {
    const payload = pendingDelete;
    setPendingDelete(null);
    deleteAction(payload);
  };

  const handleSelect = (key: string | string[] | null | undefined) => {
    const k = Array.isArray(key) ? (key[0] ?? null) : (key ?? null);
    setUserActiveKey(k);
  };

  return (
    <>
      <Accordion
        activeKey={effectiveActiveKey}
        onSelect={handleSelect}
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
                dangerouslySetInnerHTML={{
                  __html: renderedById.get(a.id) ?? "",
                }}
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
          <Button
            variant="secondary"
            onClick={() => setPendingDelete(null)}
            disabled={isDeleting}
          >
            Annulla
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? <Spinner size="sm" className="me-1" /> : null}
            Elimina
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AnalysisList;
