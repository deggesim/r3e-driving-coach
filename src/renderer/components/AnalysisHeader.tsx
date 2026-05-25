import { useState, useEffect } from "react";
import { Badge, Button, Form } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlay,
  faStop,
  faGear,
  faChartLine,
  faFilePdf,
  faArrowLeft,
  faRotateRight,
} from "@fortawesome/free-solid-svg-icons";
import { formatLapTime } from "../../shared/format";
import { useSessionStore } from "../store/sessionStore";

interface Props {
  isLive: boolean;
  sessionActive: boolean;
  currentCar: string;
  currentTrack: string;
  onStart: () => void;
  onEnd: () => void;
  onAnalyze: () => void;
  onExportPdf: () => void;
  onOpenPicker: () => void;
  onBack?: () => void;
  onReopen?: () => void;
}

const AnalysisHeader = ({
  isLive,
  sessionActive,
  currentCar,
  currentTrack,
  onStart,
  onEnd,
  onAnalyze,
  onExportPdf,
  onOpenPicker,
  onBack,
  onReopen,
}: Props) => {
  const session = useSessionStore((s) => s.session);
  const laps = useSessionStore((s) => s.laps);
  const setups = useSessionStore((s) => s.setups);
  const analyses = useSessionStore((s) => s.analyses);

  const [leaderboardMode, setLeaderboardMode] = useState(
    session?.leaderboard_mode !== 0,
  );
  const [fixedSetup, setFixedSetup] = useState(session?.fixed_setup !== 0);

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLeaderboardMode(session.leaderboard_mode !== 0);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setFixedSetup(session.fixed_setup !== 0);
  // Solo al cambio di sessione, non ad ogni aggiornamento dell'oggetto
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const isR3E = session?.game === "r3e";

  return (
    <div className="debriefing-header d-flex align-items-center gap-2 flex-wrap flex-shrink-0 p-2">
      {session ? (
        <>
          <span className="deb-car fw-bold">{currentCar}</span>
          <span className="text-muted">·</span>
          <span className="text-muted">
            {currentTrack} {session.layout_name ?? session.layout}
          </span>
          <span className="text-muted">·</span>
          <Badge
            bg={session.game === "ace" ? "info" : "secondary"}
            className="ms-1"
          >
            {session.game === "ace" ? "ACE" : "R3E"}
          </Badge>
          <Badge bg={sessionActive ? "success" : "secondary"}>
            {sessionActive ? "Attiva" : "Chiusa"}
          </Badge>
          <span className="text-muted">·</span>
          <span className="text-muted">
            {laps.length} giri
            {session.best_lap != null &&
              ` · best ${formatLapTime(session.best_lap)}`}
          </span>
        </>
      ) : (
        <span className="text-muted fst-italic">
          {isLive ? "Nessuna sessione aperta" : "Caricamento sessione…"}
        </span>
      )}

      <div className="ms-auto d-flex align-items-center gap-2 flex-wrap">
        {isR3E && session && (
          <div className="d-flex gap-3 me-1">
            <Form.Check
              type="switch"
              id="leaderboard-mode"
              label="Leaderboard"
              checked={leaderboardMode}
              onChange={(e) => {
                const val = e.target.checked;
                setLeaderboardMode(val);
                if (session)
                  void window.electronAPI.sessionUpdateFlags({
                    sessionId: session.id,
                    game: session.game,
                    leaderboardMode: val,
                    fixedSetup,
                  });
              }}
              className="text-muted"
            />
            <Form.Check
              type="switch"
              id="fixed-setup"
              label="Setup fisso"
              checked={fixedSetup}
              onChange={(e) => {
                const val = e.target.checked;
                setFixedSetup(val);
                if (session)
                  void window.electronAPI.sessionUpdateFlags({
                    sessionId: session.id,
                    game: session.game,
                    leaderboardMode,
                    fixedSetup: val,
                  });
              }}
              className="text-muted"
            />
          </div>
        )}
        <div className="d-flex gap-1 flex-wrap">
          {isLive && !sessionActive && (
            <Button size="sm" variant="success" onClick={onStart}>
              <FontAwesomeIcon icon={faPlay} className="me-1" /> Nuova sessione
            </Button>
          )}
          {isLive && sessionActive && (
            <Button size="sm" variant="secondary" onClick={onEnd}>
              <FontAwesomeIcon icon={faStop} className="me-1" /> Chiudi sessione
            </Button>
          )}
          {session && (isLive ? sessionActive : true) && (
            <Button size="sm" variant="primary" onClick={onOpenPicker}>
              <FontAwesomeIcon icon={faGear} className="me-1" /> Carica setup
              {setups.length > 0 && ` (${setups.length})`}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => onAnalyze()}
            disabled={!session || (isLive && laps.length === 0)}
          >
            <FontAwesomeIcon icon={faChartLine} className="me-1" /> Esegui
            analisi
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onExportPdf}
            disabled={!session || analyses.length === 0}
          >
            <FontAwesomeIcon icon={faFilePdf} className="me-1" /> Esporta PDF
          </Button>
          {!isLive && session && !sessionActive && onReopen && (
            <Button size="sm" variant="success" onClick={onReopen}>
              <FontAwesomeIcon icon={faRotateRight} className="me-1" />
              Riapri sessione
            </Button>
          )}
          {!isLive && onBack && (
            <Button size="sm" variant="primary" onClick={onBack}>
              <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
              Indietro
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalysisHeader;
