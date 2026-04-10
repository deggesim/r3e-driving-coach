/**
 * SessionHistory — List of past laps for the current car/track combination.
 * Loads from SQLite via IPC when car/track are known.
 */

import { useEffect, useState } from 'react';
import { Table, Spinner, Badge, Row, Col } from 'react-bootstrap';
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
      <div className="session-history d-flex align-items-center justify-content-center text-secondary h-100">
        <span>Nessuna sessione attiva</span>
      </div>
    );
  }

  return (
    <div className="session-history p-3 overflow-y-auto h-100">
      <Row className="mb-3 align-items-baseline g-0">
        <Col xs="auto" className="sh-title me-2">Storico giri</Col>
        <Col className="sh-subtitle">{status.car} · {status.track}</Col>
      </Row>

      {loading ? (
        <div className="d-flex align-items-center gap-2 text-secondary py-3">
          <Spinner size="sm" variant="danger" />
          Caricamento...
        </div>
      ) : laps.length === 0 ? (
        <p className="text-secondary py-2 mb-0">Nessun giro registrato per questa combinazione.</p>
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
