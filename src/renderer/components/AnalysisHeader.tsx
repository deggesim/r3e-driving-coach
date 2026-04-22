import { Badge, Button } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlay,
  faStop,
  faGear,
  faChartLine,
  faFilePdf,
  faArrowLeft,
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
}: Props) => {
  const session = useSessionStore((s) => s.session);
  const laps = useSessionStore((s) => s.laps);
  const setups = useSessionStore((s) => s.setups);
  const analyses = useSessionStore((s) => s.analyses);

  return (
    <div className="debriefing-header d-flex align-items-center gap-2 flex-wrap flex-shrink-0 p-2">
      {session ? (
        <>
          <span className="deb-car fw-bold">{currentCar}</span>
          <span className="deb-sep">·</span>
          <span className="deb-track">
            {currentTrack} {session.layout_name ?? session.layout}
          </span>
          <span className="deb-sep">·</span>
          <Badge bg={sessionActive ? "success" : "secondary"}>
            {sessionActive ? "Attiva" : "Chiusa"}
          </Badge>
          {!isLive && (
            <Badge bg="info" className="ms-1">
              Storica
            </Badge>
          )}
          <span className="deb-sep">·</span>
          <span className="text-muted">
            {laps.length} giri
            {session.best_lap != null &&
              ` · best ${formatLapTime(session.best_lap)}`}
          </span>
        </>
      ) : (
        <span className="deb-placeholder">
          {isLive ? "Nessuna sessione aperta" : "Caricamento sessione…"}
        </span>
      )}

      <div className="ms-auto d-flex gap-1 flex-wrap">
        {isLive && !sessionActive && (
          <Button size="sm" variant="success" onClick={onStart}>
            <FontAwesomeIcon icon={faPlay} className="me-1" /> Nuova sessione
          </Button>
        )}
        {isLive && sessionActive && (
          <Button size="sm" variant="outline-secondary" onClick={onEnd}>
            <FontAwesomeIcon icon={faStop} className="me-1" /> Chiudi sessione
          </Button>
        )}
        {isLive && sessionActive && (
          <Button size="sm" variant="outline-primary" onClick={onOpenPicker}>
            <FontAwesomeIcon icon={faGear} className="me-1" /> Carica setup
            {setups.length > 0 && ` (${setups.length})`}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          onClick={onAnalyze}
          disabled={!session || (isLive && laps.length === 0)}
        >
          <FontAwesomeIcon icon={faChartLine} className="me-1" /> Esegui analisi
        </Button>
        <Button
          size="sm"
          variant="outline-secondary"
          onClick={onExportPdf}
          disabled={!session || analyses.length === 0}
        >
          <FontAwesomeIcon icon={faFilePdf} className="me-1" /> Esporta PDF
        </Button>
        {!isLive && onBack && (
          <Button size="sm" variant="outline-primary" onClick={onBack}>
            <FontAwesomeIcon icon={faArrowLeft} className="me-1" />
            Indietro
          </Button>
        )}
      </div>
    </div>
  );
};

export default AnalysisHeader;
