/**
 * Debriefing — Post-lap panel.
 *
 * States: idle ("In attesa del giro..."), loading (Spinner), result (Template v3).
 * Layout: header with lap info, body with Template v3 rendered, footer with generated timestamp.
 */

import { useState, useEffect, useRef } from "react";
import { Spinner, Badge } from "react-bootstrap";
import { marked } from "marked";
import type { LapRecord, LapAnalysis } from "../../shared/types";

type DebriefingProps = {
  lastLap: LapRecord | null;
  lastAnalysis: LapAnalysis | null;
};

type DebriefingState = "idle" | "loading" | "result";

const formatLapTime = (seconds: number): string => {
  if (!seconds || seconds <= 0) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0
    ? `${mins}:${secs.toFixed(3).padStart(6, "0")}`
    : `${secs.toFixed(3)}s`;
};

const Debriefing = ({ lastLap, lastAnalysis }: DebriefingProps) => {
  const [state, setState] = useState<DebriefingState>("idle");
  const [displayedAnalysis, setDisplayedAnalysis] =
    useState<LapAnalysis | null>(null);
  const [displayedLap, setDisplayedLap] = useState<LapRecord | null>(null);
  const lastLapRef = useRef<LapRecord | null>(null);
  const lastAnalysisRef = useRef<LapAnalysis | null>(null);

  // New lap arrived → show loading
  useEffect(() => {
    if (!lastLap || lastLap === lastLapRef.current) return;
    lastLapRef.current = lastLap;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setDisplayedLap(lastLap);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setState("loading");
  }, [lastLap]);

  // Analysis arrived → show result
  useEffect(() => {
    if (!lastAnalysis || lastAnalysis === lastAnalysisRef.current) return;
    lastAnalysisRef.current = lastAnalysis;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setDisplayedAnalysis(lastAnalysis);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setState("result");
  }, [lastAnalysis]);

  const renderMarkdown = (md: string): string =>
    marked.parse(md, { async: false }) as string;

  return (
    <div className="d-flex flex-column h-100 overflow-hidden">
      {/* Header */}
      <div className="debriefing-header d-flex align-items-center gap-2 flex-shrink-0">
        {displayedLap ? (
          <>
            <span className="deb-car">{displayedLap.carName ?? displayedLap.car}</span>
            <span className="deb-sep">·</span>
            <span className="deb-track">
              {displayedLap.trackName ?? displayedLap.track}{" "}
              {displayedLap.layoutName ?? displayedLap.layout}
            </span>
            <span className="deb-sep">·</span>
            <span className="deb-time">
              Giro {displayedLap.lapNumber}:{" "}
              {formatLapTime(displayedLap.lapTime)}
            </span>
            {!displayedLap.valid && (
              <Badge bg="warning" text="dark" className="ms-2">
                Non valido
              </Badge>
            )}
          </>
        ) : (
          <span className="deb-placeholder">Nessun giro registrato</span>
        )}
      </div>

      {/* Body */}
      <div className="flex-grow-1 overflow-y-auto p-3">
        {state === "idle" && (
          <div className="d-flex align-items-center justify-content-center gap-2 text-secondary" style={{ height: 200 }}>
            In attesa del giro...
          </div>
        )}

        {state === "loading" && (
          <div className="d-flex align-items-center justify-content-center gap-2 text-secondary" style={{ height: 200 }}>
            <Spinner size="sm" variant="danger" />
            <span>Analisi in corso...</span>
          </div>
        )}

        {state === "result" && displayedAnalysis && (
          <div
            className="deb-content"
            // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(displayedAnalysis.templateV3),
            }}
          />
        )}
      </div>

      {/* Footer */}
      {state === "result" && displayedAnalysis && (
        <div className="debriefing-footer d-flex align-items-center justify-content-end gap-2 flex-shrink-0">
          <span className="deb-generated">
            Generato:{" "}
            {new Date(displayedAnalysis.generatedAt).toLocaleTimeString(
              "it-IT",
            )}
          </span>
        </div>
      )}
    </div>
  );
};

export default Debriefing;
