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

  // Open the streaming accordion as soon as a new streaming version starts.
  useEffect(() => {
    if (!streamingVersion) return;
    const key = `streaming-${streamingVersion.version}`;
    setActiveKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, [streamingVersion?.version]);

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

  return (
    <Accordion
      alwaysOpen
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
          <Accordion.Body className="overflow-y-auto">
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
  );
};

export default AnalysisList;
