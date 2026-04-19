/**
 * StatusBar — Always-visible bottom bar.
 * Shows: connection badge, car/track, calibration state, last alert (fade 5s).
 */

import { faMicrophone } from "@fortawesome/free-solid-svg-icons/faMicrophone";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { ReactNode } from "react";
import { Badge } from "react-bootstrap";
import type { GameStatus } from "../../shared/types";

type StatusBarProps = {
  status: GameStatus;
};

const StatusBar = ({ status }: StatusBarProps) => {
  const calibrationText: ReactNode = status.calibrating ? (
    `Calibrazione: ${status.lapsToCalibration} ${status.lapsToCalibration === 1 ? "giro rimanente" : "giri rimanenti"}`
  ) : (
    <>
      <FontAwesomeIcon icon={faMicrophone} /> Coach attivo
    </>
  );

  return (
    <div className="status-bar">
      {/* Connection — one badge per game */}
      <div className="status-connection">
        <Badge
          bg={status.r3eConnected ? "success" : "secondary"}
          className="status-badge"
        >
          R3E {status.r3eConnected ? "connesso" : "disconnesso"}
        </Badge>
        <Badge
          bg={status.aceConnected ? "success" : "secondary"}
          className="status-badge ms-1"
        >
          ACE {status.aceConnected ? "connesso" : "disconnesso"}
        </Badge>
      </div>

      {/* Car / Track */}
      {status.car && (
        <div className="status-session">
          <span className="status-car">{status.car}</span>
          {status.track && (
            <>
              <span className="status-sep"> - </span>
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
    </div>
  );
};

export default StatusBar;
