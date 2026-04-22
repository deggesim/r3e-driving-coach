import { useEffect, useMemo, useState } from "react";
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
import type { CompactFrame, GameSource, LapRow, ZoneData } from "../../shared/types";
import { useSessionStore } from "../store/sessionStore";

type ChartPoint = {
  dist: number;
  brake: number;
  throttle: number;
  speed: number;
};

const AXIS_COLOR = "#888";
const GRID_COLOR = "#2e2e2e";
const BG_TOOLTIP = "#1a1a1a";
const MAX_POINTS = 400;

type TooltipPayloadEntry = {
  dataKey: string;
  name?: string;
  value: number;
  color: string;
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

const fromFrames = (frames: CompactFrame[]): ChartPoint[] => {
  const sorted = frames.slice().sort((a, b) => a.d - b.d);
  const stride = Math.max(1, Math.ceil(sorted.length / MAX_POINTS));
  const out: ChartPoint[] = [];
  for (let i = 0; i < sorted.length; i += stride) {
    const f = sorted[i];
    out.push({
      dist: f.d,
      brake: f.brk * 100,
      throttle: f.thr * 100,
      speed: f.spd,
    });
  }
  return out;
};

const fromZones = (zonesJson: string | null): ChartPoint[] => {
  if (!zonesJson) return [];
  try {
    const zones = JSON.parse(zonesJson) as ZoneData[];
    return zones
      .slice()
      .sort((a, b) => a.dist - b.dist)
      .map((z) => ({
        dist: z.dist,
        brake: z.maxBrakePct * 100,
        throttle: z.avgThrottlePct * 100,
        speed: z.avgSpeedKmh,
      }));
  } catch {
    return [];
  }
};

type Props = {
  lap: LapRow;
};

const LapTelemetryCharts = ({ lap }: Props) => {
  const game: GameSource = useSessionStore((s) => s.session?.game ?? "r3e");
  const [frames, setFrames] = useState<CompactFrame[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFrames(null);
    window.electronAPI
      .lapGetFrames({ id: lap.id, game })
      .then((f) => {
        if (!cancelled) setFrames(f ?? []);
      })
      .catch(() => {
        if (!cancelled) setFrames([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lap.id, game]);

  const data = useMemo<ChartPoint[]>(() => {
    if (frames && frames.length > 0) return fromFrames(frames);
    return fromZones(lap.zones_json);
  }, [frames, lap.zones_json]);

  if (loading) {
    return (
      <div className="text-muted" style={{ padding: 12, fontSize: 13 }}>
        Caricamento telemetria…
      </div>
    );
  }

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
