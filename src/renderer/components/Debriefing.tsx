/**
 * Debriefing — Post-lap panel.
 *
 * States: idle ("In attesa del giro..."), loading (Spinner), result (Template v3).
 * Layout: header with lap info + setup button, body with Template v3 rendered, footer timestamp.
 *
 * The "Carica Setup" button stores a setup for the current session so that all
 * subsequent lap analyses include it. The loaded setup is sent to the main
 * process via session:setSetup and persisted alongside each lap analysis.
 */

import { useState, useEffect, useRef } from "react";
import { Spinner, Badge, Button } from "react-bootstrap";
import { marked } from "marked";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faGear } from "@fortawesome/free-solid-svg-icons";
import type { LapRecord, LapAnalysis, SetupData } from "../../shared/types";
import { formatLapTime } from "../../shared/format";
import { useSettingsStore } from "../store/settingsStore";
import { useIPCStore } from "../store/ipcStore";
import ScreenshotPicker from "./ScreenshotPicker";
import AceSetupPicker from "./AceSetupPicker";

type DebriefingProps = {
  lastLap: LapRecord | null;
  lastAnalysis: LapAnalysis | null;
};

type DebriefingState = "idle" | "loading" | "result";

const Debriefing = ({ lastLap, lastAnalysis }: DebriefingProps) => {
  const [state, setState] = useState<DebriefingState>("idle");
  const [displayedAnalysis, setDisplayedAnalysis] = useState<LapAnalysis | null>(null);
  const [displayedLap, setDisplayedLap] = useState<LapRecord | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [activeSetup, setActiveSetup] = useState<SetupData | null>(null);

  const lastLapRef = useRef<LapRecord | null>(null);
  const lastAnalysisRef = useRef<LapAnalysis | null>(null);

  const activeGame = useSettingsStore((s) => s.activeGame);
  const status = useIPCStore((s) => s.status);

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

  const handleSetupLoaded = async (setup: SetupData): Promise<void> => {
    setShowPicker(false);
    setActiveSetup(setup);
    await window.electronAPI.sessionSetSetup(setup);
  };

  const renderMarkdown = (md: string): string =>
    marked.parse(md, { async: false }) as string;

  const currentCar = status?.car ?? displayedLap?.carName ?? displayedLap?.car ?? "";
  const currentTrack = status?.track ?? displayedLap?.trackName ?? displayedLap?.track ?? "";

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

        <Button
          variant="outline-secondary"
          size="sm"
          className="ms-auto detail-action-btn"
          onClick={() => setShowPicker(true)}
        >
          <FontAwesomeIcon icon={activeSetup ? faCheck : faGear} className="me-1" />
          {activeSetup ? `Setup: ${activeSetup.carFound}` : "Carica Setup"}
        </Button>
      </div>

      {/* Body */}
      <div className="flex-grow-1 overflow-y-auto p-3">
        {state === "idle" && (
          <div
            className="d-flex align-items-center justify-content-center gap-2 text-secondary"
            style={{ height: 200 }}
          >
            In attesa del giro...
          </div>
        )}

        {state === "loading" && (
          <div
            className="d-flex align-items-center justify-content-center gap-2 text-secondary"
            style={{ height: 200 }}
          >
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
            {new Date(displayedAnalysis.generatedAt).toLocaleTimeString("it-IT")}
          </span>
        </div>
      )}

      {/* Setup pickers */}
      {activeGame === "ace" ? (
        <AceSetupPicker
          show={showPicker}
          expectedCar={currentCar}
          expectedTrack={currentTrack}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupLoaded}
        />
      ) : (
        <ScreenshotPicker
          show={showPicker}
          expectedCar={currentCar}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupLoaded}
        />
      )}
    </div>
  );
};

export default Debriefing;
