import { Button, Modal } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import type { GameSource, SessionSetupRow } from "../../shared/types";
import R3eSetupTabs from "./R3eSetupTabs";

export type SetupDetailModalProps = {
  setupId: number | null;
  setupById: Map<number, SessionSetupRow>;
  game?: GameSource;
  onClose: () => void;
  onUse?: () => void;
};

export const SetupDetailModal = ({
  setupId,
  setupById,
  game,
  onClose,
  onUse,
}: SetupDetailModalProps) => {
  if (setupId == null) return null;

  const row = setupById.get(setupId);
  if (!row) return null;

  const name = row.setup.name ?? `Setup #${setupId}`;

  return (
    <Modal
      show
      onHide={onClose}
      size="lg"
      dialogClassName="setup-detail-modal"
      centered
      contentClassName="setup-detail-content"
    >
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: 15 }}>{name}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="setup-detail-body">
        {row.setup.params.length > 0 ? (
          game === "ace" ? (
            <table className="setup-table w-100">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Parametro</th>
                  <th>Valore</th>
                </tr>
              </thead>
              <tbody>
                {row.setup.params.map((p) => (
                  <tr key={`${p.category}__${p.parameter}`}>
                    <td className="text-muted">{p.category}</td>
                    <td>{p.parameter}</td>
                    <td className="setup-value">{p.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <R3eSetupTabs params={row.setup.params} />
          )
        ) : (
          <p className="text-muted mb-0">Nessun parametro disponibile.</p>
        )}
      </Modal.Body>
      {onUse && (
        <Modal.Footer>
          <Button size="sm" variant="outline-primary" onClick={onUse}>
            <FontAwesomeIcon icon={faCheck} className="me-1" />
            Usa questo setup
          </Button>
        </Modal.Footer>
      )}
    </Modal>
  );
};
