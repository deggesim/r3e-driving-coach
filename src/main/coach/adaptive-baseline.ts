/**
 * AdaptiveBaseline — EMA (alpha=0.3) baseline per 50m zone.
 *
 * Detects deviations: LATE_BRAKE, SLOW_THROTTLE, TRAIL_BRAKING, COASTING, BRAKE_THROTTLE_OVERLAP.
 * Persists to SQLite: baseline, baseline_tc_zones, baseline_abs_zones tables.
 */

import type Database from 'better-sqlite3';
import { BASELINE_EMA_ALPHA, DEVIATION_THRESHOLDS } from '../../shared/alert-types';
import type { ZoneData, Deviation, DeviationType } from '../../shared/types';

type BaselineZone = {
  avgSpeedKmh: number;
  minSpeedKmh: number;
  maxBrakePct: number;
  avgThrottlePct: number;
  steerDuringBrake: number;
  brakeFrames: number;
  throttleFrames: number;
  coastFrames: number;
  overlapFrames: number;
  brakeStartDist: number | null;
  brakeEndDist: number | null;
  throttlePickupDist: number | null;
};

export type AdaptiveBaseline = {
  readonly car: string;
  readonly track: string;
  isReady: () => boolean;
  ingestLap: (zones: ZoneData[], lapNumber: number, isCalibrating: boolean) => Deviation[] | null;
  checkZoneRealtime: (zoneData: { zone: number; tcActive: boolean; absActive: boolean }) => {
    tcAnomaly: boolean;
    absAnomaly: boolean;
  };
};

const ema = (prev: number, current: number, alpha: number): number =>
  alpha * current + (1 - alpha) * prev;

const makeDeviation = (type: DeviationType, zone: ZoneData, delta: number, message: string): Deviation => ({
  type, zone: zone.zone, dist: zone.dist, delta, message,
});

export const createAdaptiveBaseline = (car: string, track: string, db?: Database.Database, game = 'r3e'): AdaptiveBaseline => {
  const zones = new Map<number, BaselineZone>();
  const tcZones = new Set<number>();
  const absZones = new Set<number>();
  let ready = false;
  const dbRef = db ?? null;

  const updateZone = (zone: ZoneData): void => {
    const alpha = BASELINE_EMA_ALPHA;
    const existing = zones.get(zone.zone);

    if (!existing) {
      zones.set(zone.zone, {
        avgSpeedKmh: zone.avgSpeedKmh,
        minSpeedKmh: zone.minSpeedKmh,
        maxBrakePct: zone.maxBrakePct,
        avgThrottlePct: zone.avgThrottlePct,
        steerDuringBrake: zone.steerDuringBrake,
        brakeFrames: zone.brakeFrames,
        throttleFrames: zone.throttleFrames,
        coastFrames: zone.coastFrames,
        overlapFrames: zone.overlapFrames,
        brakeStartDist: zone.brakeStartDist,
        brakeEndDist: zone.brakeEndDist,
        throttlePickupDist: zone.throttlePickupDist,
      });
    } else {
      existing.avgSpeedKmh = ema(existing.avgSpeedKmh, zone.avgSpeedKmh, alpha);
      existing.minSpeedKmh = ema(existing.minSpeedKmh, zone.minSpeedKmh, alpha);
      existing.maxBrakePct = ema(existing.maxBrakePct, zone.maxBrakePct, alpha);
      existing.avgThrottlePct = ema(existing.avgThrottlePct, zone.avgThrottlePct, alpha);
      existing.steerDuringBrake = ema(existing.steerDuringBrake, zone.steerDuringBrake, alpha);
      existing.brakeFrames = ema(existing.brakeFrames, zone.brakeFrames, alpha);
      existing.throttleFrames = ema(existing.throttleFrames, zone.throttleFrames, alpha);
      existing.coastFrames = ema(existing.coastFrames, zone.coastFrames, alpha);
      existing.overlapFrames = ema(existing.overlapFrames, zone.overlapFrames, alpha);
      if (zone.brakeStartDist !== null) {
        existing.brakeStartDist =
          existing.brakeStartDist !== null
            ? ema(existing.brakeStartDist, zone.brakeStartDist, alpha)
            : zone.brakeStartDist;
      }
      if (zone.brakeEndDist !== null) {
        existing.brakeEndDist =
          existing.brakeEndDist !== null
            ? ema(existing.brakeEndDist, zone.brakeEndDist, alpha)
            : zone.brakeEndDist;
      }
      if (zone.throttlePickupDist !== null) {
        existing.throttlePickupDist =
          existing.throttlePickupDist !== null
            ? ema(existing.throttlePickupDist, zone.throttlePickupDist, alpha)
            : zone.throttlePickupDist;
      }
    }

    if (zone.tcActivations > 0) tcZones.add(zone.zone);
    if (zone.absActivations > 0) absZones.add(zone.zone);
  };

  const detectDeviations = (zoneList: ZoneData[]): Deviation[] => {
    const deviations: Deviation[] = [];
    const t = DEVIATION_THRESHOLDS;

    for (const zone of zoneList) {
      const base = zones.get(zone.zone);
      if (!base) continue;

      // LATE_BRAKE: brake started 15m+ later than baseline
      if (
        zone.brakeStartDist !== null &&
        base.brakeStartDist !== null &&
        zone.brakeStartDist - base.brakeStartDist > t.lateBrakeMeters
      ) {
        const delta = zone.brakeStartDist - base.brakeStartDist;
        deviations.push(makeDeviation('LATE_BRAKE', zone, delta, `frenato ${delta.toFixed(0)} metri dopo il riferimento`));
      }

      // SLOW_THROTTLE: throttle pickup 12m+ later than baseline
      if (
        zone.throttlePickupDist !== null &&
        base.throttlePickupDist !== null &&
        zone.throttlePickupDist - base.throttlePickupDist > t.slowThrottleMeters
      ) {
        const delta = zone.throttlePickupDist - base.throttlePickupDist;
        deviations.push(makeDeviation('SLOW_THROTTLE', zone, delta, `gas ripreso ${delta.toFixed(0)} metri in ritardo`));
      }

      // TRAIL_BRAKING: steer during brake increased by 0.08+ vs baseline
      if (zone.steerDuringBrake - base.steerDuringBrake > t.trailBrakingSteerDelta) {
        const delta = zone.steerDuringBrake - base.steerDuringBrake;
        deviations.push(makeDeviation('TRAIL_BRAKING', zone, delta, `sterzata in frenata anomala, delta ${(delta * 100).toFixed(0)}%`));
      }

      // COASTING: 8+ extra coast frames vs baseline
      if (zone.coastFrames - base.coastFrames > t.coastingExtraFrames) {
        const delta = zone.coastFrames - base.coastFrames;
        deviations.push(makeDeviation('COASTING', zone, delta, `${delta.toFixed(0)} frame di coasting in più del riferimento`));
      }

      // BRAKE_THROTTLE_OVERLAP: 5+ extra overlap frames vs baseline
      if (zone.overlapFrames - base.overlapFrames > t.overlapExtraFrames) {
        const delta = zone.overlapFrames - base.overlapFrames;
        deviations.push(makeDeviation('BRAKE_THROTTLE_OVERLAP', zone, delta, `${delta.toFixed(0)} frame di overlap freno-gas in più`));
      }
    }

    return deviations;
  };

  const loadFromDb = (): void => {
    if (!dbRef) return;

    const rows = dbRef.prepare(
      'SELECT zone_id, data FROM baseline WHERE car = ? AND track = ? AND game = ?',
    ).all(car, track, game) as Array<{ zone_id: number; data: string }>;
    for (const row of rows) zones.set(row.zone_id, JSON.parse(row.data));

    const tcRows = dbRef.prepare(
      'SELECT zone_id FROM baseline_tc_zones WHERE car = ? AND track = ? AND game = ?',
    ).all(car, track, game) as Array<{ zone_id: number }>;
    for (const row of tcRows) tcZones.add(row.zone_id);

    const absRows = dbRef.prepare(
      'SELECT zone_id FROM baseline_abs_zones WHERE car = ? AND track = ? AND game = ?',
    ).all(car, track, game) as Array<{ zone_id: number }>;
    for (const row of absRows) absZones.add(row.zone_id);

    if (zones.size > 0) ready = true;
  };

  const persistToDb = (): void => {
    if (!dbRef) return;

    const upsert = dbRef.prepare(`
      INSERT OR REPLACE INTO baseline (car, track, zone_id, game, data, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    const upsertTc = dbRef.prepare(`
      INSERT OR IGNORE INTO baseline_tc_zones (car, track, zone_id, game)
      VALUES (?, ?, ?, ?)
    `);
    const upsertAbs = dbRef.prepare(`
      INSERT OR IGNORE INTO baseline_abs_zones (car, track, zone_id, game)
      VALUES (?, ?, ?, ?)
    `);

    const tx = dbRef.transaction(() => {
      for (const [zoneId, data] of zones) {
        upsert.run(car, track, zoneId, game, JSON.stringify(data));
      }
      for (const zoneId of tcZones) {
        upsertTc.run(car, track, zoneId, game);
      }
      for (const zoneId of absZones) {
        upsertAbs.run(car, track, zoneId, game);
      }
    });

    tx();
  };

  if (dbRef) loadFromDb();

  return {
    car,
    track,
    isReady: () => ready,
    ingestLap: (zoneList, _lapNumber, isCalibrating) => {
      for (const zone of zoneList) updateZone(zone);
      if (dbRef) persistToDb();
      if (isCalibrating) {
        ready = true;
        return null;
      }
      return detectDeviations(zoneList);
    },
    checkZoneRealtime: (zoneData) => ({
      tcAnomaly: zoneData.tcActive && !tcZones.has(zoneData.zone),
      absAnomaly: zoneData.absActive && !absZones.has(zoneData.zone),
    }),
  };
};
