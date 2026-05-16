import { useState } from "react";
import { Nav } from "react-bootstrap";
import type { SetupParam } from "../../shared/types";

const ACE_TAB_ORDER = [
  "Pneumatici",
  "Elettronica",
  "Carburante e Strategia",
  "Sospensioni",
  "Ammortizzatori",
  "Aerodinamica",
] as const;
type AceTabId = (typeof ACE_TAB_ORDER)[number];

const WHEEL_KEYS = ["FL", "FR", "RL", "RR"] as const;
type WheelKey = (typeof WHEEL_KEYS)[number];

const WHEEL_LABELS: Record<WheelKey, string> = {
  FL: "Ant. Sinistro",
  FR: "Ant. Destro",
  RL: "Post. Sinistro",
  RR: "Post. Destro",
};

function getAceTab(p: SetupParam): AceTabId {
  switch (p.category) {
    case "Pneumatici":
    case "Geometria":
      return "Pneumatici";
    case "Elettronica":
      return "Elettronica";
    case "Carburante":
    case "Identificazione":
      return "Carburante e Strategia";
    case "Sospensioni":
    case "Sterzo":
    case "Freni":
      return "Sospensioni";
    case "Ammortizzatori":
      return "Ammortizzatori";
    case "Aerodinamica":
    case "Assetto":
      return "Aerodinamica";
    default:
      return "Aerodinamica";
  }
}

function getWheelKey(parameter: string): WheelKey | null {
  for (const key of WHEEL_KEYS) {
    if (new RegExp(`\\s${key}(\\s|$)`).test(parameter)) return key;
  }
  return null;
}

function stripWheelSuffix(parameter: string): string {
  return parameter.replace(/\s+(FL|FR|RL|RR)(?=\s|$)/, "").trim();
}

function ParamTable({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <table className="setup-tab-table w-100">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="text-muted">{r.label}</td>
            <td className="setup-value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FourCornerGrid({ params }: { params: SetupParam[] }) {
  const byWheel: Partial<Record<WheelKey, SetupParam[]>> = {};
  const shared: SetupParam[] = [];

  for (const p of params) {
    const key = getWheelKey(p.parameter);
    if (key) {
      if (!byWheel[key]) byWheel[key] = [];
      byWheel[key]!.push(p);
    } else {
      shared.push(p);
    }
  }

  const rows: [WheelKey, WheelKey][] = [
    ["FL", "FR"],
    ["RL", "RR"],
  ];

  return (
    <div>
      {rows.map(([left, right]) => (
        <div key={left} className="d-flex gap-2 mb-2">
          {([left, right] as WheelKey[]).map((key) => (
            <div key={key} className="setup-axle-col">
              <div className="setup-subsection-title">{WHEEL_LABELS[key]}</div>
              <ParamTable
                rows={(byWheel[key] ?? []).map((p) => ({
                  label: stripWheelSuffix(p.parameter),
                  value: p.value,
                }))}
              />
            </div>
          ))}
        </div>
      ))}
      {shared.length > 0 && (
        <ParamTable
          rows={shared.map((p) => ({ label: p.parameter, value: p.value }))}
        />
      )}
    </div>
  );
}
