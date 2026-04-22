import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import { Badge, Table } from "react-bootstrap";
import { formatLapTime } from "../../shared/format";
import { useSessionStore } from "../store/sessionStore";

type LapsTableProps = {
  setupById: Map<number, string>;
};

const LapsTable = ({ setupById }: LapsTableProps) => {
  const laps = useSessionStore((s) => s.laps);
  return (
    <Table striped size="sm" variant="dark" className="align-middle">
      <thead>
        <tr>
          <th>#</th>
          <th>Tempo</th>
          <th>S1</th>
          <th>S2</th>
          <th>S3</th>
          <th>Valido</th>
          <th>Setup</th>
          <th>Data</th>
        </tr>
      </thead>
      <tbody>
        {laps.length === 0 && (
          <tr>
            <td colSpan={8} className="text-center text-muted">
              Nessun giro
            </td>
          </tr>
        )}
        {laps.map((l) => (
          <tr key={l.id}>
            <td>{l.lap_number}</td>
            <td>{formatLapTime(l.lap_time)}</td>
            <td>{l.sector1 != null ? formatLapTime(l.sector1) : "--"}</td>
            <td>{l.sector2 != null ? formatLapTime(l.sector2) : "--"}</td>
            <td>{l.sector3 != null ? formatLapTime(l.sector3) : "--"}</td>
            <td>
              {l.valid ? (
                <FontAwesomeIcon icon={faCheck} className="text-success" />
              ) : (
                <FontAwesomeIcon icon={faXmark} className="text-danger" />
              )}
            </td>
            <td>
              {l.setup_id != null ? (
                <Badge bg="info" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }} title={setupById.get(l.setup_id)}>
                  {setupById.get(l.setup_id) ?? `#${l.setup_id}`}
                </Badge>
              ) : (
                <span className="text-muted">—</span>
              )}
            </td>
            <td>{new Date(l.recorded_at).toLocaleString("it-IT")}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

export default LapsTable;
