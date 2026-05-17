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

const getAceTab = (p: SetupParam): AceTabId => {
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
};

const getWheelKey = (parameter: string): WheelKey | null => {
  for (const key of WHEEL_KEYS) {
    if (new RegExp(`\\s${key}(\\s|$)`).test(parameter)) return key;
  }
  return null;
};

const stripWheelSuffix = (parameter: string): string =>
  parameter.replace(/\s+(FL|FR|RL|RR)(?=\s|$)/, "").trim();

const ParamTable = ({ rows }: { rows: Array<{ label: string; value: string }> }) => {
  return (
    <table className="setup-tab-table w-100">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="text-muted">{r.label}</td>
            <td className="setup-value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const FourCornerGrid = ({ params }: { params: SetupParam[] }) => {
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

const SuspensionTab = ({ params }: { params: SetupParam[] }) => {
  const firstCornerIdx = params.findIndex((p) => getWheelKey(p.parameter) !== null);
  const lastCornerIdx = params.reduce(
    (acc, p, i) => (getWheelKey(p.parameter) !== null ? i : acc),
    -1,
  );

  const sharedTop =
    firstCornerIdx > 0 ? params.slice(0, firstCornerIdx) : [];
  const cornerBlock =
    firstCornerIdx >= 0
      ? params.slice(firstCornerIdx, lastCornerIdx + 1)
      : [];
  const sharedBottom =
    lastCornerIdx >= 0 && lastCornerIdx < params.length - 1
      ? params.slice(lastCornerIdx + 1)
      : [];

  return (
    <div>
      {sharedTop.length > 0 && (
        <div className="mb-2">
          <ParamTable
            rows={sharedTop.map((p) => ({ label: p.parameter, value: p.value }))}
          />
        </div>
      )}
      {cornerBlock.length > 0 && (
        <div className="mb-2">
          <FourCornerGrid params={cornerBlock} />
        </div>
      )}
      {sharedBottom.length > 0 && (
        <div className="mb-2">
          <ParamTable
            rows={sharedBottom.map((p) => ({
              label: p.parameter,
              value: p.value,
            }))}
          />
        </div>
      )}
    </div>
  );
}

const AceSetupTabs = ({ params }: { params: SetupParam[] }) => {
  const byTab: Partial<Record<AceTabId, SetupParam[]>> = {};
  for (const p of params) {
    const tab = getAceTab(p);
    if (!byTab[tab]) byTab[tab] = [];
    byTab[tab]!.push(p);
  }

  const available = ACE_TAB_ORDER.filter((t) => (byTab[t]?.length ?? 0) > 0);
  const [active, setActive] = useState<AceTabId>(
    () => available[0] ?? "Pneumatici",
  );

  if (available.length === 0) return null;

  const flatRows = (tab: AceTabId) =>
    (byTab[tab] ?? []).map((p) => ({ label: p.parameter, value: p.value }));

  return (
    <div>
      <Nav
        variant="tabs"
        className="setup-nav-tabs mb-2"
        activeKey={active}
        onSelect={(k) => k && setActive(k as AceTabId)}
      >
        {available.map((t) => (
          <Nav.Item key={t}>
            <Nav.Link eventKey={t}>{t}</Nav.Link>
          </Nav.Item>
        ))}
      </Nav>
      <div className="setup-tab-body">
        {active === "Pneumatici" && (
          <FourCornerGrid params={byTab["Pneumatici"] ?? []} />
        )}
        {active === "Elettronica" && (
          <ParamTable rows={flatRows("Elettronica")} />
        )}
        {active === "Carburante e Strategia" && (
          <ParamTable rows={flatRows("Carburante e Strategia")} />
        )}
        {active === "Sospensioni" && (
          <SuspensionTab params={byTab["Sospensioni"] ?? []} />
        )}
        {active === "Ammortizzatori" && (
          <FourCornerGrid params={byTab["Ammortizzatori"] ?? []} />
        )}
        {active === "Aerodinamica" && (
          <ParamTable rows={flatRows("Aerodinamica")} />
        )}
      </div>
    </div>
  );
};

export default AceSetupTabs;
