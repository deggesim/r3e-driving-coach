/**
 * LapRecorder — Attaches to R3EReader, aggregates frames into 50m zones.
 *
 * Events:
 *   lapRecorded(lap: LapRecord, { calibrating: boolean })
 *   newBestLap(lap: LapRecord)
 *   calibrationComplete()
 */

import { EventEmitter } from "events";
import { ZONE_SIZE_M, CALIBRATION_LAPS } from "../../shared/alert-types";
import type { CompactFrame, LapRecord, ZoneData } from "../../shared/types";

/** Minimal reader interface required by LapRecorder (duck-typed by both R3EReader and AceReader). */
interface LapEventReader {
  on(
    event: 'lapComplete',
    listener: (data: {
      lapNumber: number;
      lapTime: number;
      sectorTimes: number[];
      frames: CompactFrame[];
      car: string;
      track: string;
      layout: string;
      layoutLength: number;
      valid: boolean;
    }) => void,
  ): void;
}

export type LapRecorder = {
  attach: (reader: LapEventReader) => void;
  isCalibrating: () => boolean;
  lapsToCalibration: () => number;
  on: EventEmitter["on"];
};

const aggregateZones = (
  frames: CompactFrame[],
  layoutLength: number,
): ZoneData[] => {
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
    const coastFrames = zoneFrames.filter(
      (f) => f.brk <= 0.05 && f.thr <= 0.05,
    );
    const overlapFrames = zoneFrames.filter(
      (f) => f.brk > 0.05 && f.thr > 0.05,
    );

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
        if (f.d > brakeEndDist && f.thr > 0.2) {
          throttlePickupDist = f.d;
          break;
        }
      }
    }

    // Steer during brake (average absolute steer while braking)
    const steerDuringBrakeValues = brakeFrames.map((f) => Math.abs(f.str));
    const steerDuringBrake =
      steerDuringBrakeValues.length > 0
        ? steerDuringBrakeValues.reduce((a, b) => a + b, 0) /
          steerDuringBrakeValues.length
        : 0;

    // Extended fields (ACE only)
    const avgArr = (vals: number[]): number =>
      vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

    const rpmValues = zoneFrames.map((f) => f.rpm).filter((v): v is number => v !== undefined);
    const gLatValues = zoneFrames.map((f) => f.gLat).filter((v): v is number => v !== undefined);
    const gLonValues = zoneFrames.map((f) => f.gLon).filter((v): v is number => v !== undefined);
    const hasExtended = rpmValues.length > 0;

    const avgByWheel = (idx: number, key: 'tp' | 'sr' | 'sus'): number => {
      const vals = zoneFrames.map((f) => f[key]?.[idx]).filter((v): v is number => v !== undefined);
      return avgArr(vals);
    };

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
      ...(hasExtended && {
        avgRpm: avgArr(rpmValues),
        maxGLat: gLatValues.length > 0 ? Math.max(...gLatValues.map(Math.abs)) : undefined,
        maxGLon: gLonValues.length > 0 ? Math.max(...gLonValues.map(Math.abs)) : undefined,
        avgTyrePressure: [avgByWheel(0, 'tp'), avgByWheel(1, 'tp'), avgByWheel(2, 'tp'), avgByWheel(3, 'tp')] as [number, number, number, number],
        avgSlipRatio:    [avgByWheel(0, 'sr'), avgByWheel(1, 'sr'), avgByWheel(2, 'sr'), avgByWheel(3, 'sr')] as [number, number, number, number],
        avgSuspTravel:   [avgByWheel(0, 'sus'), avgByWheel(1, 'sus'), avgByWheel(2, 'sus'), avgByWheel(3, 'sus')] as [number, number, number, number],
      }),
    });
  }

  return zones;
};

export const createLapRecorder = (hasExistingBaseline = false): LapRecorder => {
  const emitter = new EventEmitter();
  let bestLapTime = Infinity;
  let lapsRecorded = 0;
  let calibrationDone = hasExistingBaseline;

  const onLapComplete = (lapData: {
    lapNumber: number;
    lapTime: number;
    sectorTimes: number[];
    frames: CompactFrame[];
    car: string;
    track: string;
    layout: string;
    layoutLength: number;
    valid: boolean;
  }): void => {
    const zones = aggregateZones(lapData.frames, lapData.layoutLength);

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

    lapsRecorded++;
    const calibrating = !calibrationDone;

    if (!calibrationDone && lapsRecorded >= CALIBRATION_LAPS) {
      calibrationDone = true;
      emitter.emit("calibrationComplete");
    }

    if (lap.valid && lap.lapTime < bestLapTime) {
      bestLapTime = lap.lapTime;
      emitter.emit("newBestLap", lap);
    }

    emitter.emit("lapRecorded", lap, { calibrating });
  };

  return {
    attach: (reader) => {
      reader.on("lapComplete", onLapComplete);
    },
    isCalibrating: () => !calibrationDone,
    lapsToCalibration: () =>
      calibrationDone ? 0 : Math.max(0, CALIBRATION_LAPS - lapsRecorded),
    on: emitter.on.bind(emitter),
  };
};
