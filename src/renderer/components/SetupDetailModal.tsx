import { Modal } from "react-bootstrap";
import type { SessionSetupRow } from "../../shared/types";
import R3eSetupTabs from "./R3eSetupTabs";

export type SetupDetailModalProps = {
  setupId: number | null;
  setupById: Map<number, SessionSetupRow>;
  onClose: () => void;
};

export const SetupDetailModal = ({
  setupId,
  setupById,
  onClose,
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
          <R3eSetupTabs params={row.setup.params} />
        ) : (
          <p className="text-muted mb-0">Nessun parametro disponibile.</p>
        )}
      </Modal.Body>
    </Modal>
  );
};
