/**
 * ZoneTracker — Tracks the current 50m zone during a lap.
 *
 * Factory function. Used by RuleEngine.processFrame()
 * to feed AdaptiveBaseline.checkZoneRealtime().
 */

import { ZONE_SIZE_M } from "../../shared/alert-types";
import type { R3EFrame } from "../../shared/types";

type CurrentZone = {
  zone: number;
  dist: number;
  tcActive: boolean;
  absActive: boolean;
  enteredAt: number;
  frameCount: number;
};

export type ZoneTracker = {
  /** Call on every frame. Returns true if the zone changed. */
  update: (frame: R3EFrame) => boolean;
  getCurrentZone: () => CurrentZone | null;
  getPreviousZoneId: () => number;
  reset: () => void;
};

export const createZoneTracker = (): ZoneTracker => {
  let current: CurrentZone | null = null;
  let previousZone = -1;

  return {
    update: (frame) => {
      const zoneId = Math.floor(frame.lapDistance / ZONE_SIZE_M);

      if (current === null || zoneId !== current.zone) {
        previousZone = current?.zone ?? -1;
        current = {
          zone: zoneId,
          dist: zoneId * ZONE_SIZE_M,
          tcActive: frame.tcActive > 0,
          absActive: frame.absActive > 0,
          enteredAt: Date.now(),
          frameCount: 1,
        };
        return true;
      }

      current.frameCount++;
      if (frame.tcActive > 0) current.tcActive = true;
      if (frame.absActive > 0) current.absActive = true;
      return false;
    },

    getCurrentZone: () => current,
    getPreviousZoneId: () => previousZone,

    reset: () => {
      current = null;
      previousZone = -1;
    },
  };
};
