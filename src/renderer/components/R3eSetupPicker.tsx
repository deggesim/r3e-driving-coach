import { useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { SetupData, SetupParam } from "../../shared/types";
import R3eSetupTabs from "./R3eSetupTabs";

type Props = {
  show: boolean;
  expectedCar: string;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

type R3ESetupItem = {
  id: string;
  currentStep: number;
  minValue: number;
  stepSize: number;
  suffix: string | string[];
  disabled: boolean;
};

function categorize(id: string): string {
  if (/^Brake/.test(id)) return "Freni";
  if (/^Fuel/.test(id)) return "Carburante";
  if (/^Tyre/.test(id)) return "Gomme";
  if (/^(Steering|Ffb)/.test(id)) return "Sterzo";
  if (/^AntiRollBar/.test(id)) return "ARB";
  if (/^Toein/.test(id)) return "Geometria";
  if (/^(Splitter|Wing|Aero)/.test(id)) return "Aerodinamica";
  if (/^(Springs|RideHeight|Camber|Bump|Rebound|FastBump|FastRebound)/.test(id))
    return "Sospensioni";
  if (/^ABS/.test(id)) return "ABS";
  if (/^Tc/.test(id)) return "Controllo Trazione";
  if (/^(Rev|Engine)/.test(id)) return "Motore";
  if (/Gear$/.test(id)) return "Trasmissione";
  if (/^Differential/.test(id)) return "Differenziale";
  if (/^(MGU|Discharge|Regen)/.test(id)) return "Ibrido";
  return "Altro";
}

function idToLabel(id: string): string {
  return id
    .replace(/Toein/g, "Toe In")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

const TYRE_COMPOUNDS: Record<number, string> = { 0: "Hard", 1: "Medium", 2: "Soft" };

function formatValue(item: R3ESetupItem): string {
  const val = item.minValue + item.currentStep * item.stepSize;
  const rounded = Math.round(val * 1000) / 1000;

  if (/^BrakeBias/.test(item.id) && val >= 0 && val <= 1) {
    const front = ((1 - val) * 100).toFixed(2);
    const rear = (val * 100).toFixed(2);
    return `${front}/${rear}%`;
  }

  if (/^TyreCompound(Front|Rear)$/.test(item.id)) {
    return TYRE_COMPOUNDS[Math.round(val)] ?? String(Math.round(val));
  }

  if (/^Springs(Front|Rear)(Left|Right)$/.test(item.id)) return `${rounded} N/mm`;
  if (/^TyrePressure(Front|Rear)(Left|Right)$/.test(item.id)) return `${rounded} kPa`;
  if (/^RideHeight(Front|Rear)(Left|Right)$/.test(item.id)) return `${rounded} cm`;
  if (/^Fuel/.test(item.id)) return `${rounded} L`;

  const suffix = Array.isArray(item.suffix) ? item.suffix[0] : item.suffix;
  return suffix ? `${rounded} ${suffix}` : String(rounded);
}

function parseR3EJson(text: string): SetupParam[] {
  const parsed = JSON.parse(text) as { values?: R3ESetupItem[] };
  if (!parsed.values || !Array.isArray(parsed.values)) {
    throw new Error("Formato JSON non valido: manca il campo 'values'");
  }
  return parsed.values
    .filter((item) => !item.disabled)
    .map((item) => ({
      category: categorize(item.id),
      parameter: idToLabel(item.id),
      value: formatValue(item),
    }));
}

const R3eSetupPicker = ({ show, expectedCar, onClose, onConfirm }: Props) => {
  const [jsonText, setJsonText] = useState("");
  const [setupName, setSetupName] = useState("");
  const [params, setParams] = useState<SetupParam[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleParse = (): void => {
    setError(null);
    try {
      setParams(parseR3EJson(jsonText));
    } catch (e) {
      setError(e instanceof Error ? e.message : "JSON non valido");
      setParams(null);
    }
  };

  const handleConfirm = (): void => {
    if (!params || !setupName.trim()) return;
    onConfirm({
      name: setupName.trim(),
      carVerified: true,
      carFound: expectedCar,
      setupText: "",
      params,
      screenshots: [],
    });
    handleClose();
  };

  const handleClose = (): void => {
    setJsonText("");
    setSetupName("");
    setParams(null);
    setError(null);
    onClose();
  };

  return (
    <Modal
      show={show}
      onHide={handleClose}
      size="xl"
      className="screenshot-picker-modal"
    >
      <Modal.Header className="picker-header">
        <Modal.Title className="picker-title">
          Incolla JSON setup
          <span className="picker-subtitle"> · {expectedCar}</span>
        </Modal.Title>
        <Button variant="link" className="picker-close" onClick={handleClose}>
          <FontAwesomeIcon icon={faXmark} />
        </Button>
      </Modal.Header>

      <Modal.Body className="picker-body">
        {error && <div className="picker-error mb-3">{error}</div>}

        {!params ? (
          <Form.Group>
            <Form.Label className="text-dim" style={{ fontSize: 13 }}>
              Incolla il JSON esportato da RaceRoom (CTRL+C nella schermata del
              setup)
            </Form.Label>
            <Form.Control
              as="textarea"
              rows={14}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={
                '{\n  "values": [...],\n  "action": "setCarSetupValues"\n}'
              }
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                background: "var(--bg2)",
                color: "var(--text)",
                borderColor: "var(--border)",
              }}
            />
          </Form.Group>
        ) : (
          <>
            <Form.Group className="mb-3" style={{ maxWidth: 360 }}>
              <Form.Label className="text-dim" style={{ fontSize: 13 }}>
                Nome setup <span className="text-danger">*</span>
              </Form.Label>
              <Form.Control
                size="sm"
                type="text"
                placeholder="es. Qualifica Monza baseline"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                autoFocus
              />
            </Form.Group>

            <div className="picker-params">
              <R3eSetupTabs params={params} />
            </div>
          </>
        )}
      </Modal.Body>

      <Modal.Footer className="picker-footer">
        {!params ? (
          <>
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Annulla
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!jsonText.trim()}
              onClick={handleParse}
            >
              Analizza JSON
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setParams(null);
                setSetupName("");
              }}
            >
              Modifica JSON
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!setupName.trim()}
              onClick={handleConfirm}
            >
              <FontAwesomeIcon icon={faCheck} className="me-1" />
              Salva setup
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default R3eSetupPicker;
