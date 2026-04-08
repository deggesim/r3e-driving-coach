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

export class AdaptiveBaseline {
  private car: string;
  private track: string;
  private db: Database.Database | null;
  private zones = new Map<number, BaselineZone>();
  private tcZones = new Set<number>();
  private absZones = new Set<number>();
  private ready = false;

  constructor(car: string, track: string, db?: Database.Database) {
    this.car = car;
    this.track = track;
    this.db = db ?? null;

    if (this.db) {
      this.loadFromDb();
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Ingest a lap's zone data into the baseline.
   * Returns deviations if baseline is ready, null during calibration.
   */
  ingestLap(zones: ZoneData[], _lapNumber: number, isCalibrating: boolean): Deviation[] | null {
    for (const zone of zones) {
      this.updateZone(zone);
    }

    if (this.db) {
      this.persistToDb();
    }

    if (isCalibrating) {
      this.ready = true; // Mark ready after first ingest
      return null;
    }

    return this.detectDeviations(zones);
  }

  /**
   * Check a zone in real-time for TC/ABS anomalies (P2 alerts).
   */
  checkZoneRealtime(zoneData: { zone: number; tcActive: boolean; absActive: boolean }): {
    tcAnomaly: boolean;
    absAnomaly: boolean;
  } {
    return {
      tcAnomaly: zoneData.tcActive && !this.tcZones.has(zoneData.zone),
      absAnomaly: zoneData.absActive && !this.absZones.has(zoneData.zone),
    };
  }

  private updateZone(zone: ZoneData): void {
    const alpha = BASELINE_EMA_ALPHA;
    const existing = this.zones.get(zone.zone);

    if (!existing) {
      // First observation — set directly
      this.zones.set(zone.zone, {
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
      // EMA update
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

    // Update TC/ABS zone profiles
    if (zone.tcActivations > 0) this.tcZones.add(zone.zone);
    if (zone.absActivations > 0) this.absZones.add(zone.zone);
  }

  private detectDeviations(zones: ZoneData[]): Deviation[] {
    const deviations: Deviation[] = [];
    const t = DEVIATION_THRESHOLDS;

    for (const zone of zones) {
      const base = this.zones.get(zone.zone);
      if (!base) continue;

      // LATE_BRAKE: brake started 15m+ later than baseline
      if (
        zone.brakeStartDist !== null &&
        base.brakeStartDist !== null &&
        zone.brakeStartDist - base.brakeStartDist > t.lateBrakeMeters
      ) {
        const delta = zone.brakeStartDist - base.brakeStartDist;
        deviations.push(deviation('LATE_BRAKE', zone, delta, `frenato ${delta.toFixed(0)} metri dopo il riferimento`));
      }

      // SLOW_THROTTLE: throttle pickup 12m+ later than baseline
      if (
        zone.throttlePickupDist !== null &&
        base.throttlePickupDist !== null &&
        zone.throttlePickupDist - base.throttlePickupDist > t.slowThrottleMeters
      ) {
        const delta = zone.throttlePickupDist - base.throttlePickupDist;
        deviations.push(deviation('SLOW_THROTTLE', zone, delta, `gas ripreso ${delta.toFixed(0)} metri in ritardo`));
      }

      // TRAIL_BRAKING: steer during brake increased by 0.08+ vs baseline
      if (
        zone.steerDuringBrake - base.steerDuringBrake > t.trailBrakingSteerDelta
      ) {
        const delta = zone.steerDuringBrake - base.steerDuringBrake;
        deviations.push(deviation('TRAIL_BRAKING', zone, delta, `sterzata in frenata anomala, delta ${(delta * 100).toFixed(0)}%`));
      }

      // COASTING: 8+ extra coast frames vs baseline
      if (zone.coastFrames - base.coastFrames > t.coastingExtraFrames) {
        const delta = zone.coastFrames - base.coastFrames;
        deviations.push(deviation('COASTING', zone, delta, `${delta.toFixed(0)} frame di coasting in più del riferimento`));
      }

      // BRAKE_THROTTLE_OVERLAP: 5+ extra overlap frames vs baseline
      if (zone.overlapFrames - base.overlapFrames > t.overlapExtraFrames) {
        const delta = zone.overlapFrames - base.overlapFrames;
        deviations.push(deviation('BRAKE_THROTTLE_OVERLAP', zone, delta, `${delta.toFixed(0)} frame di overlap freno-gas in più`));
      }
    }

    return deviations;
  }

  // --- SQLite persistence ---

  private loadFromDb(): void {
    if (!this.db) return;

    const rows = this.db.prepare(
      'SELECT zone_id, data FROM baseline WHERE car = ? AND track = ?',
    ).all(this.car, this.track) as Array<{ zone_id: number; data: string }>;

    for (const row of rows) {
      this.zones.set(row.zone_id, JSON.parse(row.data));
    }

    const tcRows = this.db.prepare(
      'SELECT zone_id FROM baseline_tc_zones WHERE car = ? AND track = ?',
    ).all(this.car, this.track) as Array<{ zone_id: number }>;
    for (const row of tcRows) this.tcZones.add(row.zone_id);

    const absRows = this.db.prepare(
      'SELECT zone_id FROM baseline_abs_zones WHERE car = ? AND track = ?',
    ).all(this.car, this.track) as Array<{ zone_id: number }>;
    for (const row of absRows) this.absZones.add(row.zone_id);

    if (this.zones.size > 0) {
      this.ready = true;
    }
  }

  private persistToDb(): void {
    if (!this.db) return;

    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO baseline (car, track, zone_id, data, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    const upsertTc = this.db.prepare(`
      INSERT OR IGNORE INTO baseline_tc_zones (car, track, zone_id)
      VALUES (?, ?, ?)
    `);

    const upsertAbs = this.db.prepare(`
      INSERT OR IGNORE INTO baseline_abs_zones (car, track, zone_id)
      VALUES (?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const [zoneId, data] of this.zones) {
        upsert.run(this.car, this.track, zoneId, JSON.stringify(data));
      }
      for (const zoneId of this.tcZones) {
        upsertTc.run(this.car, this.track, zoneId);
      }
      for (const zoneId of this.absZones) {
        upsertAbs.run(this.car, this.track, zoneId);
      }
    });

    tx();
  }
}

function ema(prev: number, current: number, alpha: number): number {
  return alpha * current + (1 - alpha) * prev;
}

function deviation(type: DeviationType, zone: ZoneData, delta: number, message: string): Deviation {
  return { type, zone: zone.zone, dist: zone.dist, delta, message };
}
