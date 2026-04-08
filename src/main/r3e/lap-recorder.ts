/**
 * LapRecorder — Attaches to R3EReader, aggregates frames into 50m zones.
 *
 * Events:
 *   lapRecorded(lap: LapRecord, { calibrating: boolean })
 *   newBestLap(lap: LapRecord)
 *   calibrationComplete()
 */

import { EventEmitter } from 'events';
import { ZONE_SIZE_M, CALIBRATION_LAPS } from '../../shared/alert-types';
import type { CompactFrame, LapRecord, ZoneData } from '../../shared/types';
import type { R3EReader } from './r3e-reader';

export class LapRecorder extends EventEmitter {
  private bestLapTime = Infinity;
  private lapsRecorded = 0;
  private calibrationDone = false;
  private hasExistingBaseline: boolean;

  constructor(hasExistingBaseline = false) {
    super();
    this.hasExistingBaseline = hasExistingBaseline;
    if (hasExistingBaseline) {
      this.calibrationDone = true;
    }
  }

  attach(reader: R3EReader): void {
    reader.on('lapComplete', (lapData) => this.onLapComplete(lapData));
  }

  get isCalibrating(): boolean {
    return !this.calibrationDone;
  }

  get lapsToCalibration(): number {
    if (this.calibrationDone) return 0;
    return Math.max(0, CALIBRATION_LAPS - this.lapsRecorded);
  }

  private onLapComplete(lapData: {
    lapNumber: number;
    lapTime: number;
    sectorTimes: number[];
    frames: CompactFrame[];
    car: string;
    track: string;
    layout: string;
    layoutLength: number;
    valid: boolean;
  }): void {
    const zones = this.aggregateZones(lapData.frames, lapData.layoutLength);

    const lap: LapRecord = {
      lapNumber: lapData.lapNumber,
      lapTime: lapData.lapTime,
      sectorTimes: lapData.sectorTimes,
      valid: lapData.valid,
      car: lapData.car,
      track: lapData.track,
      layout: lapData.layout,
      layoutLength: lapData.layoutLength,
      frames: lapData.frames,
      zones,
      recordedAt: new Date().toISOString(),
    };

    this.lapsRecorded++;
    const calibrating = !this.calibrationDone;

    // Check calibration completion
    if (!this.calibrationDone && this.lapsRecorded >= CALIBRATION_LAPS) {
      this.calibrationDone = true;
      this.emit('calibrationComplete');
    }

    // Track best lap
    if (lap.valid && lap.lapTime < this.bestLapTime) {
      this.bestLapTime = lap.lapTime;
      this.emit('newBestLap', lap);
    }

    this.emit('lapRecorded', lap, { calibrating });
  }

  private aggregateZones(frames: CompactFrame[], layoutLength: number): ZoneData[] {
    const numZones = Math.ceil(layoutLength / ZONE_SIZE_M);
    const zoneMap = new Map<number, CompactFrame[]>();

    for (const frame of frames) {
      const zoneId = Math.min(Math.floor(frame.d / ZONE_SIZE_M), numZones - 1);
      if (!zoneMap.has(zoneId)) zoneMap.set(zoneId, []);
      zoneMap.get(zoneId)!.push(frame);
    }

    const zones: ZoneData[] = [];

    for (let z = 0; z < numZones; z++) {
      const zoneFrames = zoneMap.get(z);
      if (!zoneFrames || zoneFrames.length === 0) continue;

      const speeds = zoneFrames.map((f) => f.spd);
      const brakes = zoneFrames.map((f) => f.brk);
      const throttles = zoneFrames.map((f) => f.thr);

      const brakeFrames = zoneFrames.filter((f) => f.brk > 0.05);
      const throttleFrames = zoneFrames.filter((f) => f.thr > 0.05);
      const coastFrames = zoneFrames.filter((f) => f.brk <= 0.05 && f.thr <= 0.05);
      const overlapFrames = zoneFrames.filter((f) => f.brk > 0.05 && f.thr > 0.05);

      // Brake start/end distances
      let brakeStartDist: number | null = null;
      let brakeEndDist: number | null = null;
      for (const f of zoneFrames) {
        if (f.brk > 0.05) {
          if (brakeStartDist === null) brakeStartDist = f.d;
          brakeEndDist = f.d;
        }
      }

      // Throttle pickup: first frame with thr > 20% after last brake frame
      let throttlePickupDist: number | null = null;
      if (brakeEndDist !== null) {
        for (const f of zoneFrames) {
          if (f.d > brakeEndDist && f.thr > 0.20) {
            throttlePickupDist = f.d;
            break;
          }
        }
      }

      // Steer during brake (average absolute steer while braking)
      const steerDuringBrakeValues = brakeFrames.map((f) => Math.abs(f.str));
      const steerDuringBrake =
        steerDuringBrakeValues.length > 0
          ? steerDuringBrakeValues.reduce((a, b) => a + b, 0) / steerDuringBrakeValues.length
          : 0;

      zones.push({
        zone: z,
        dist: z * ZONE_SIZE_M,
        avgSpeedKmh: speeds.reduce((a, b) => a + b, 0) / speeds.length,
        minSpeedKmh: Math.min(...speeds),
        maxBrakePct: Math.max(...brakes),
        avgThrottlePct: throttles.reduce((a, b) => a + b, 0) / throttles.length,
        maxSteerAbs: Math.max(...zoneFrames.map((f) => Math.abs(f.str))),
        steerDuringBrake,
        brakeFrames: brakeFrames.length,
        throttleFrames: throttleFrames.length,
        coastFrames: coastFrames.length,
        overlapFrames: overlapFrames.length,
        tcActivations: zoneFrames.filter((f) => f.tc > 0).length,
        absActivations: zoneFrames.filter((f) => f.abs > 0).length,
        brakeStartDist,
        brakeEndDist,
        throttlePickupDist,
      });
    }

    return zones;
  }
}
