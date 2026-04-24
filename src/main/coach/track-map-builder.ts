/**
 * TrackMapBuilder — derives a 2D SVG path of the circuit outline from a lap's
 * telemetry frames (world-space X/Z), inspired by SecondMonitor's
 * TrackMapFromTelemetryFactory.
 *
 * Sampling: ~100ms (stride computed from timestamps). Output coordinates are
 * kept in world-space metres; the renderer scales them via SVG viewBox.
 */

import type { CompactFrame, TrackMapGeometry } from "../../shared/types.js";

const SAMPLE_INTERVAL_MS = 100;
const BOUNDS_MARGIN_M = 30;
const MIN_SAMPLES = 20;

const hasWorldPos = (f: CompactFrame): boolean =>
  typeof f.wx === "number" && typeof f.wz === "number";

/**
 * Down-samples frames to ~1 sample per SAMPLE_INTERVAL_MS based on timestamps.
 */
const downsample = (frames: CompactFrame[]): CompactFrame[] => {
  if (frames.length === 0) return [];
  const sorted = frames
    .filter(hasWorldPos)
    .slice()
    .sort((a, b) => a.ts - b.ts);
  if (sorted.length === 0) return [];

  const out: CompactFrame[] = [sorted[0]];
  let lastTs = sorted[0].ts;

  for (let i = 1; i < sorted.length; i++) {
    const f = sorted[i];
    if (f.ts - lastTs < SAMPLE_INTERVAL_MS) continue;
    out.push(f);
    lastTs = f.ts;
  }
  return out;
};

/**
 * Builds a TrackMapGeometry from a lap's frames. Returns null if insufficient
 * samples or missing world-position data.
 */
export const buildTrackMap = (
  frames: CompactFrame[],
  layoutLength: number,
): TrackMapGeometry | null => {
  const samples = downsample(frames);
  if (samples.length < MIN_SAMPLES) return null;

  // Negate wz so that the SVG vertical axis (Y-down) matches the world
  // orientation: world Z increases away from the viewer (north), but SVG Y
  // increases downward, which would mirror the track top-to-bottom without negation.
  // Game-specific X mirroring is handled at render time in TrackMapSvg.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity; // in negated-Z space
  let maxZ = -Infinity;
  for (const f of samples) {
    const x = f.wx!;
    const z = -f.wz!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  minX -= BOUNDS_MARGIN_M;
  maxX += BOUNDS_MARGIN_M;
  minZ -= BOUNDS_MARGIN_M;
  maxZ += BOUNDS_MARGIN_M;

  const pathParts: string[] = [];
  for (let i = 0; i < samples.length; i++) {
    const cmd = i === 0 ? "M" : "L";
    const x = samples[i].wx!.toFixed(1);
    const z = (-samples[i].wz!).toFixed(1);
    pathParts.push(`${cmd} ${x} ${z}`);
  }
  // Close visually by returning to the first sample (avoids the arbitrary straight
  // line that SVG "Z" draws when first and last sample aren't at the same point).
  const x0 = samples[0].wx!.toFixed(1);
  const z0 = (-samples[0].wz!).toFixed(1);
  pathParts.push(`L ${x0} ${z0}`);

  return {
    svgPath: pathParts.join(" "),
    bounds: { minX, maxX, minZ, maxZ },
    sampleCount: samples.length,
    layoutLength,
  };
};
