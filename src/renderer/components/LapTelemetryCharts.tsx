import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { LapRow, ZoneData } from "../../shared/types";

type ChartPoint = {
  dist: number;
  brake: number;
  throttle: number;
  speed: number;
};

const AXIS_COLOR = "#888";
const GRID_COLOR = "#2e2e2e";
const BG_TOOLTIP = "#1a1a1a";

type TooltipPayloadEntry = {
  dataKey: string;
  name?: string;
  value: number;
  color: string;
  unit?: string;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: number;
};

const formatDist = (v: number) => `${Math.round(v)} m`;

const PedalsTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        background: BG_TOOLTIP,
        border: `1px solid ${GRID_COLOR}`,
        borderRadius: 4,
        padding: "6px 10px",
        fontSize: 12,
        color: "#e8e8e8",
      }}
    >
      <div style={{ color: "#888", marginBottom: 4 }}>{formatDist(label ?? 0)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {Math.round(p.value)}%
        </div>
      ))}
    </div>
  );
};

const SpeedTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  return (
    <div
      style={{
        background: BG_TOOLTIP,
        border: `1px solid ${GRID_COLOR}`,
        borderRadius: 4,
        padding: "6px 10px",
        fontSize: 12,
        color: "#e8e8e8",
      }}
    >
      <div style={{ color: "#888", marginBottom: 4 }}>{formatDist(label ?? 0)}</div>
      <div style={{ color: p.color }}>
        {p.name}: {Math.round(p.value)} km/h
      </div>
    </div>
  );
};

type Props = {
  lap: LapRow;
};

const LapTelemetryCharts = ({ lap }: Props) => {
  const data = useMemo<ChartPoint[]>(() => {
    if (!lap.zones_json) return [];
    try {
      const zones = JSON.parse(lap.zones_json) as ZoneData[];
      return zones
        .slice()
        .sort((a, b) => a.dist - b.dist)
        .map((z) => ({
          dist: z.dist,
          brake: z.maxBrakePct,
          throttle: z.avgThrottlePct,
          speed: z.avgSpeedKmh,
        }));
    } catch {
      return [];
    }
  }, [lap.zones_json]);

  if (data.length === 0) {
    return (
      <div className="text-muted" style={{ padding: 12, fontSize: 13 }}>
        Nessun dato di telemetria disponibile per questo giro.
      </div>
    );
  }

  const axisProps = {
    stroke: AXIS_COLOR,
    tick: { fill: AXIS_COLOR, fontSize: 11 },
    tickLine: { stroke: AXIS_COLOR },
    axisLine: { stroke: GRID_COLOR },
  } as const;

  return (
    <div style={{ padding: "8px 4px 4px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 4, paddingLeft: 8 }}>
          Freno / Acceleratore (%)
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
            <XAxis
              dataKey="dist"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => `${Math.round(v)}`}
              unit=" m"
              {...axisProps}
            />
            <YAxis domain={[0, 100]} unit="%" {...axisProps} />
            <Tooltip
              content={<PedalsTooltip />}
              cursor={{ stroke: "#555", strokeDasharray: "3 3" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "#e8e8e8" }}
              iconType="plainline"
            />
            <Line
              type="monotone"
              dataKey="brake"
              name="Freno"
              stroke="#e8451a"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="throttle"
              name="Acceleratore"
              stroke="#3ecf3e"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 4, paddingLeft: 8 }}>
          Velocità (km/h)
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
            <XAxis
              dataKey="dist"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => `${Math.round(v)}`}
              unit=" m"
              {...axisProps}
            />
            <YAxis domain={[0, "dataMax + 20"]} unit=" km/h" {...axisProps} />
            <Tooltip
              content={<SpeedTooltip />}
              cursor={{ stroke: "#555", strokeDasharray: "3 3" }}
            />
            <Line
              type="monotone"
              dataKey="speed"
              name="Velocità"
              stroke="#f1c40f"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default LapTelemetryCharts;
