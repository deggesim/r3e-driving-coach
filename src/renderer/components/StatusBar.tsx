/**
 * StatusBar — Always-visible bottom bar.
 * Shows: connection badge, car/track, calibration state, last alert (fade 5s).
 */

import { faMicrophone } from "@fortawesome/free-solid-svg-icons/faMicrophone";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Badge } from "react-bootstrap";
import type { Alert, R3EStatus } from "../../shared/types";
import { useSettingsStore } from "../store/settingsStore";

type StatusBarProps = {
  status: R3EStatus;
  lastAlert: Alert | null;
};

const StatusBar = ({ status, lastAlert }: StatusBarProps) => {
  const activeGame = useSettingsStore((s) => s.activeGame);
  const [visibleAlert, setVisibleAlert] = useState<string | null>(null);
  const [fadeOut, setFadeOut] = useState(false);

  // Show alert for 5s then fade
  useEffect(() => {
    if (!lastAlert) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setVisibleAlert(lastAlert.message);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setFadeOut(false);

    const fadeTimer = setTimeout(() => setFadeOut(true), 4000);
    const clearTimer = setTimeout(() => setVisibleAlert(null), 5000);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(clearTimer);
    };
  }, [lastAlert]);

  const calibrationText: ReactNode = status.calibrating ? (
    `Calibrazione: ${status.lapsToCalibration} ${status.lapsToCalibration === 1 ? "giro rimanente" : "giri rimanenti"}`
  ) : (
    <>
      <FontAwesomeIcon icon={faMicrophone} /> Coach attivo
    </>
  );

  return (
    <div className="status-bar">
      {/* Connection */}
      <div className="status-connection">
        <Badge
          bg={status.connected ? "success" : "danger"}
          className="status-badge"
        >
          {status.connected
            ? `${activeGame === "ace" ? "ACE" : "R3E"} connesso`
            : `${activeGame === "ace" ? "ACE" : "R3E"} disconnesso`}
        </Badge>
      </div>

      {/* Car / Track */}
      {status.car && (
        <div className="status-session">
          <span className="status-car">{status.car}</span>
          {status.track && (
            <>
              <span className="status-sep">·</span>
              <span className="status-track">
                {status.track}
                {status.layout ? ` (${status.layout})` : ""}
              </span>
            </>
          )}
        </div>
      )}

      {/* Calibration / Active */}
      <div className="status-calibration">
        {status.connected ? calibrationText : "—"}
      </div>

      {/* Last alert */}
      <div className={`status-alert ${fadeOut ? "fade-out" : ""}`}>
        {visibleAlert ?? ""}
      </div>
    </div>
  );
};

export default StatusBar;
