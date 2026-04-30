import { useState } from "react";
import { Nav } from "react-bootstrap";
import type { SetupParam } from "../../shared/types";

const TAB_ORDER = ["Generale", "Anteriore", "Posteriore", "Elettronica", "Trasmissione", "Volante"] as const;
type TabId = (typeof TAB_ORDER)[number];

type Section =
  | "shared" | "left" | "right"
  | "abs_front" | "abs_rear" | "tc_cut" | "tc_slip" | "tc_lat"
  | "engine" | "gears" | "diff" | "hybrid"
  | "default";

function getTab(p: SetupParam): TabId {
  const { category, parameter } = p;
  if (category === "Sterzo") return "Volante";
  if (category === "ABS" || category === "Controllo Trazione") return "Elettronica";
  if (category === "Motore" || category === "Trasmissione" || category === "Differenziale" || category === "Ibrido")
    return "Trasmissione";
  if (category === "Freni" || category === "Carburante") return "Generale";
  if (category === "Gomme" && parameter.includes("Compound")) return "Generale";
  if (parameter.includes("Front")) return "Anteriore";
  if (parameter.includes("Rear")) return "Posteriore";
  if (category === "Aerodinamica") return "Anteriore"; // Splitter (no axle suffix)
  return "Generale";
}

function getSection(p: SetupParam, tab: TabId): Section {
  const { category, parameter } = p;
  if (tab === "Anteriore" || tab === "Posteriore") {
    if (/Left/.test(parameter)) return "left";
    if (/Right/.test(parameter)) return "right";
    return "shared";
  }
  if (tab === "Elettronica") {
    if (category === "ABS" && /Front/.test(parameter)) return "abs_front";
    if (category === "ABS" && /Rear/.test(parameter)) return "abs_rear";
    if (/Lat/.test(parameter)) return "tc_lat";
    if (/Slip/.test(parameter)) return "tc_slip";
    return "tc_cut";
  }
  if (tab === "Trasmissione") {
    if (category === "Motore") return "engine";
    if (category === "Trasmissione") return "gears";
    if (category === "Differenziale") return "diff";
    if (category === "Ibrido") return "hybrid";
  }
  return "default";
}

function cleanLabel(parameter: string, section: Section): string {
  switch (section) {
    case "left":
    case "right":
      return parameter.replace(/\s+(Front|Rear)\s+(Left|Right)/i, "").trim();
    case "shared":
      return parameter.replace(/\s+(Front|Rear)$/i, "").trim();
    case "abs_front":
    case "abs_rear":
      return parameter.replace(/ABS\s+Slip\s+(Front|Rear)\s+Preset\s+/i, "Preset ").trim();
    case "tc_cut":
      return parameter.replace(/Tc\s+Preset\s+/i, "Preset ").trim();
    case "tc_slip":
      return parameter.replace(/Tc\s+Slip\s+Preset\s+/i, "Preset ").trim();
    case "tc_lat":
      return parameter.replace(/Tc\s+Lat\s+Preset\s+/i, "Preset ").trim();
    default:
      return parameter;
  }
}

function ParamTable({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <table className="setup-tab-table w-100">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="text-dim">{r.label}</td>
            <td className="setup-value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SimpleTab({ params }: { params: SetupParam[] }) {
  return <ParamTable rows={params.map((p) => ({ label: p.parameter, value: p.value }))} />;
}

function AxleTab({ params, axle }: { params: SetupParam[]; axle: "Anteriore" | "Posteriore" }) {
  const prefix = axle === "Anteriore" ? "Ant." : "Post.";
  const shared = params.filter((p) => getSection(p, axle) === "shared");
  const left = params.filter((p) => getSection(p, axle) === "left");
  const right = params.filter((p) => getSection(p, axle) === "right");
  return (
    <div>
      {shared.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">Condiviso</div>
          <ParamTable rows={shared.map((p) => ({ label: cleanLabel(p.parameter, "shared"), value: p.value }))} />
        </div>
      )}
      <div className="setup-axle-columns">
        {left.length > 0 && (
          <div className="setup-axle-col">
            <div className="setup-subsection-title">{prefix} Sinistra</div>
            <ParamTable rows={left.map((p) => ({ label: cleanLabel(p.parameter, "left"), value: p.value }))} />
          </div>
        )}
        {right.length > 0 && (
          <div className="setup-axle-col">
            <div className="setup-subsection-title">{prefix} Destra</div>
            <ParamTable rows={right.map((p) => ({ label: cleanLabel(p.parameter, "right"), value: p.value }))} />
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <>
      <div className="setup-subsection-title">{title}</div>
      <ParamTable rows={rows} />
    </>
  );
}

function ElettronicaTab({ params }: { params: SetupParam[] }) {
  const absF = params.filter((p) => getSection(p, "Elettronica") === "abs_front");
  const absR = params.filter((p) => getSection(p, "Elettronica") === "abs_rear");
  const tcCut = params.filter((p) => getSection(p, "Elettronica") === "tc_cut");
  const tcSlip = params.filter((p) => getSection(p, "Elettronica") === "tc_slip");
  const tcLat = params.filter((p) => getSection(p, "Elettronica") === "tc_lat");

  const absBoth = absF.length > 0 && absR.length > 0;
  const tcTypeCount = [tcCut, tcSlip, tcLat].filter((g) => g.length > 0).length;

  return (
    <div>
      {(absF.length > 0 || absR.length > 0) && (
        absBoth ? (
          <div className="setup-axle-columns mb-2">
            <div className="setup-axle-col">
              <Section title="ABS Anteriore" rows={absF.map((p) => ({ label: cleanLabel(p.parameter, "abs_front"), value: p.value }))} />
            </div>
            <div className="setup-axle-col">
              <Section title="ABS Posteriore" rows={absR.map((p) => ({ label: cleanLabel(p.parameter, "abs_rear"), value: p.value }))} />
            </div>
          </div>
        ) : (
          <div className="mb-2">
            {absF.length > 0 && <Section title="ABS Anteriore" rows={absF.map((p) => ({ label: cleanLabel(p.parameter, "abs_front"), value: p.value }))} />}
            {absR.length > 0 && <Section title="ABS Posteriore" rows={absR.map((p) => ({ label: cleanLabel(p.parameter, "abs_rear"), value: p.value }))} />}
          </div>
        )
      )}
      {tcTypeCount === 1 ? (
        <div className="mb-2">
          {tcCut.length > 0 && <Section title="TC Cut" rows={tcCut.map((p) => ({ label: cleanLabel(p.parameter, "tc_cut"), value: p.value }))} />}
          {tcSlip.length > 0 && <Section title="TC Slip" rows={tcSlip.map((p) => ({ label: cleanLabel(p.parameter, "tc_slip"), value: p.value }))} />}
          {tcLat.length > 0 && <Section title="TC Laterale" rows={tcLat.map((p) => ({ label: cleanLabel(p.parameter, "tc_lat"), value: p.value }))} />}
        </div>
      ) : tcTypeCount > 1 ? (
        <>
          {(tcCut.length > 0 || tcSlip.length > 0) && (
            <div className="setup-axle-columns mb-2">
              {tcCut.length > 0 && (
                <div className="setup-axle-col">
                  <Section title="TC Cut" rows={tcCut.map((p) => ({ label: cleanLabel(p.parameter, "tc_cut"), value: p.value }))} />
                </div>
              )}
              {tcSlip.length > 0 && (
                <div className="setup-axle-col">
                  <Section title="TC Slip" rows={tcSlip.map((p) => ({ label: cleanLabel(p.parameter, "tc_slip"), value: p.value }))} />
                </div>
              )}
            </div>
          )}
          {tcLat.length > 0 && (
            <div className="setup-axle-columns mb-2">
              <div className="setup-axle-col">
                <Section title="TC Laterale" rows={tcLat.map((p) => ({ label: cleanLabel(p.parameter, "tc_lat"), value: p.value }))} />
              </div>
              <div className="setup-axle-col" />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function TrasmissioneTab({ params }: { params: SetupParam[] }) {
  const engine = params.filter((p) => getSection(p, "Trasmissione") === "engine");
  const gears = params.filter((p) => getSection(p, "Trasmissione") === "gears");
  const diff = params.filter((p) => getSection(p, "Trasmissione") === "diff");
  const hybrid = params.filter((p) => getSection(p, "Trasmissione") === "hybrid");
  return (
    <div>
      {engine.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">Motore</div>
          <ParamTable rows={engine.map((p) => ({ label: p.parameter, value: p.value }))} />
        </div>
      )}
      {gears.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">Marce</div>
          <ParamTable rows={gears.map((p) => ({ label: p.parameter, value: p.value }))} />
        </div>
      )}
      {diff.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">Differenziale</div>
          <ParamTable rows={diff.map((p) => ({ label: p.parameter, value: p.value }))} />
        </div>
      )}
      {hybrid.length > 0 && (
        <div className="mb-2">
          <div className="setup-subsection-title">Ibrido</div>
          <ParamTable rows={hybrid.map((p) => ({ label: p.parameter, value: p.value }))} />
        </div>
      )}
    </div>
  );
}

const R3eSetupTabs = ({ params }: { params: SetupParam[] }) => {
  const byTab: Partial<Record<TabId, SetupParam[]>> = {};
  for (const p of params) {
    const tab = getTab(p);
    if (!byTab[tab]) byTab[tab] = [];
    byTab[tab]!.push(p);
  }

  const available = TAB_ORDER.filter((t) => (byTab[t]?.length ?? 0) > 0);
  const [active, setActive] = useState<TabId>(() => available[0] ?? "Generale");

  if (available.length === 0) return null;

  return (
    <div className="setup-tabs-container">
      <Nav
        variant="tabs"
        className="setup-nav-tabs mb-2"
        activeKey={active}
        onSelect={(k) => k && setActive(k as TabId)}
      >
        {available.map((t) => (
          <Nav.Item key={t}>
            <Nav.Link eventKey={t}>{t}</Nav.Link>
          </Nav.Item>
        ))}
      </Nav>
      <div className="setup-tab-body">
        {active === "Generale" && <SimpleTab params={byTab["Generale"] ?? []} />}
        {active === "Anteriore" && <AxleTab params={byTab["Anteriore"] ?? []} axle="Anteriore" />}
        {active === "Posteriore" && <AxleTab params={byTab["Posteriore"] ?? []} axle="Posteriore" />}
        {active === "Elettronica" && <ElettronicaTab params={byTab["Elettronica"] ?? []} />}
        {active === "Trasmissione" && <TrasmissioneTab params={byTab["Trasmissione"] ?? []} />}
        {active === "Volante" && <SimpleTab params={byTab["Volante"] ?? []} />}
      </div>
    </div>
  );
};

export default R3eSetupTabs;
