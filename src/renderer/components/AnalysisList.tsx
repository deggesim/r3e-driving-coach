import { marked } from "marked";
import { useEffect, useState } from "react";
import { Accordion, Spinner } from "react-bootstrap";
import { useSessionStore } from "../store/sessionStore";

type StreamingVersion = { sessionId: number; version: number; text: string };

type Props = {
  streamingVersion: StreamingVersion | null;
};

const renderMd = (md: string): string =>
  marked.parse(md, { async: false }) as string;

const AnalysisList = ({ streamingVersion }: Props) => {
  const analyses = useSessionStore((s) => s.analyses);

  const latestKey = streamingVersion
    ? `streaming-${streamingVersion.version}`
    : analyses.length > 0
      ? `v${analyses[analyses.length - 1].version}`
      : undefined;

  const [activeKeys, setActiveKeys] = useState<string[]>(
    latestKey ? [latestKey] : [],
  );

  useEffect(() => {
    if (latestKey) {
      setActiveKeys((prev) =>
        prev.includes(latestKey) ? prev : [...prev, latestKey],
      );
    }
  }, [latestKey]);

  return (
    <Accordion
      alwaysOpen
      activeKey={activeKeys}
      onSelect={(keys) => setActiveKeys((keys as string[]) ?? [])}
    >
      {analyses.map((a) => (
        <Accordion.Item key={a.id} eventKey={`v${a.version}`}>
          <Accordion.Header>
            Analisi #{a.version}
            <span className="ms-2">
              {new Date(a.created_at).toLocaleString("it-IT")}
            </span>
          </Accordion.Header>
          <Accordion.Body>
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
          <Accordion.Body>
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
