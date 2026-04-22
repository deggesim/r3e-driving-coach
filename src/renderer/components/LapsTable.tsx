import { Fragment, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faXmark, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { Badge, Table } from "react-bootstrap";
import { formatLapTime } from "../../shared/format";
import { useSessionStore } from "../store/sessionStore";
import LapTelemetryCharts from "./LapTelemetryCharts";

type LapsTableProps = {
  setupById: Map<number, string>;
};

const LapsTable = ({ setupById }: LapsTableProps) => {
  const laps = useSessionStore((s) => s.laps);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const toggle = (id: number, valid: boolean) => {
    if (!valid) return;
    setExpandedId((cur) => (cur === id ? null : id));
  };

  return (
    <Table striped size="sm" variant="dark" className="align-middle laps-table">
      <thead>
        <tr>
          <th style={{ width: 24 }}></th>
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
            <td colSpan={9} className="text-center text-muted">
              Nessun giro
            </td>
          </tr>
        )}
        {laps.map((l) => {
          const expanded = expandedId === l.id;
          const clickable = !!l.valid;
          return (
            <Fragment key={l.id}>
              <tr
                onClick={() => toggle(l.id, l.valid)}
                style={{
                  cursor: clickable ? "pointer" : "default",
                  background: expanded ? "var(--bg3)" : undefined,
                }}
                title={clickable ? "Mostra telemetria" : "Giro non valido"}
              >
                <td style={{ color: "var(--text-dim)" }}>
                  {clickable && (
                    <FontAwesomeIcon
                      icon={faChevronRight}
                      style={{
                        transition: "transform 0.25s ease",
                        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                        fontSize: 11,
                      }}
                    />
                  )}
                </td>
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
              <tr className="lap-telemetry-row">
                <td colSpan={9} style={{ padding: 0, background: "var(--bg2)" }}>
                  <div
                    className={`lap-telemetry-wrapper${expanded ? " open" : ""}`}
                    aria-hidden={!expanded}
                  >
                    <div className="lap-telemetry-inner">
                      {expanded && <LapTelemetryCharts lap={l} />}
                    </div>
                  </div>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
};

export default LapsTable;
