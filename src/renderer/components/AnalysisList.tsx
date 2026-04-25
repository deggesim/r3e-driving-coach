import { marked } from "marked";
import { useEffect, useRef, useState } from "react";
import { Accordion, Spinner } from "react-bootstrap";
import { useSessionStore } from "../store/sessionStore";

type StreamingVersion = { sessionId: number; version: number; text: string };

type Props = {
  streamingVersion: StreamingVersion | null;
  startClosed?: boolean;
};

const renderMd = (md: string): string =>
  marked.parse(md, { async: false }) as string;

const AnalysisList = ({ streamingVersion, startClosed = false }: Props) => {
  const analyses = useSessionStore((s) => s.analyses);

  const [activeKeys, setActiveKeys] = useState<string[]>(() => {
    if (startClosed || analyses.length === 0) return [];
    return [`v${analyses[analyses.length - 1].version}`];
  });

  // Track which version was streaming so we can open it only when complete
  const pendingVersionRef = useRef<number | null>(null);
  useEffect(() => {
    if (streamingVersion) {
      pendingVersionRef.current = streamingVersion.version;
    } else if (pendingVersionRef.current !== null) {
      const completedVersion = pendingVersionRef.current;
      const found = analyses.find((a) => a.version === completedVersion);
      if (found) {
        const key = `v${completedVersion}`;
        setActiveKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
        pendingVersionRef.current = null;
      }
    }
  }, [streamingVersion, analyses]);

  return (
    <Accordion
      activeKey={activeKeys}
      onSelect={(keys) => setActiveKeys((keys as string[]) ?? [])}
      className="analysis-accordion"
    >
      {analyses.map((a) => (
        <Accordion.Item key={a.id} eventKey={`v${a.version}`}>
          <Accordion.Header>
            Analisi #{a.version}
            <span className="ms-2">
              {new Date(a.created_at).toLocaleString("it-IT")}
            </span>
          </Accordion.Header>
          <Accordion.Body
            className="overflow-y-auto"
          >
            <div
              className="deb-content"
              // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
              dangerouslySetInnerHTML={{ __html: renderMd(a.template_v3) }}
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
          <Accordion.Body
            className="overflow-y-auto"
          >
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
  );
};

export default AnalysisList;
