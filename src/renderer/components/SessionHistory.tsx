/**
 * SessionHistory — List of past laps for the current car/track combination.
 * Loads from SQLite via IPC when car/track are known.
 */

import { useEffect, useState } from 'react';
import { Table, Spinner, Badge } from 'react-bootstrap';
import type { R3EStatus, LapRow } from '../../shared/types';

type SessionHistoryProps = {
  status: R3EStatus;
};

const formatLapTime = (seconds: number | null): string => {
  if (!seconds || seconds <= 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0
    ? `${mins}:${secs.toFixed(3).padStart(6, '0')}`
    : `${secs.toFixed(3)}s`;
};

const SessionHistory = ({ status }: SessionHistoryProps) => {
  const [laps, setLaps] = useState<LapRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!status.car || !status.track || !window.electronAPI) return;

    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setLoading(true);
    window.electronAPI
      .getLaps({ car: status.car, track: status.track })
      .then((data) => {
        setLaps(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status.car, status.track]);

  if (!status.car) {
    return (
      <div className="session-history empty">
        <span>Nessuna sessione attiva</span>
      </div>
    );
  }

  return (
    <div className="session-history">
      <div className="sh-header">
        <span className="sh-title">Storico giri</span>
        <span className="sh-subtitle">{status.car} · {status.track}</span>
      </div>

      {loading ? (
        <div className="sh-loading">
          <Spinner size="sm" variant="danger" className="me-2" />
          Caricamento...
        </div>
      ) : laps.length === 0 ? (
        <div className="sh-empty">Nessun giro registrato per questa combinazione.</div>
      ) : (
        <Table hover size="sm" className="sh-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Tempo</th>
              <th>S1</th>
              <th>S2</th>
              <th>S3</th>
              <th>V</th>
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr key={lap.id} className={!lap.valid ? 'invalid' : ''}>
                <td>{lap.lap_number}</td>
                <td className="sh-laptime">{formatLapTime(lap.lap_time)}</td>
                <td>{formatLapTime(lap.sector1)}</td>
                <td>{formatLapTime(lap.sector2)}</td>
                <td>{formatLapTime(lap.sector3)}</td>
                <td>
                  {lap.valid
                    ? <Badge bg="success" pill>✓</Badge>
                    : <Badge bg="secondary" pill>✗</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

export default SessionHistory;
