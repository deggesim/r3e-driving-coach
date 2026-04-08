/**
 * ZoneTracker — Tracks the current 50m zone during a lap.
 *
 * Stateful object (not EventEmitter). Used by RuleEngine.processFrame()
 * to feed AdaptiveBaseline.checkZoneRealtime().
 */

import { ZONE_SIZE_M } from '../../shared/alert-types';
import type { R3EFrame } from '../../shared/types';

type CurrentZone = {
  zone: number;
  dist: number;
  tcActive: boolean;
  absActive: boolean;
  enteredAt: number;
  frameCount: number;
};

export class ZoneTracker {
  private current: CurrentZone | null = null;
  private previousZone = -1;

  /**
   * Call on every frame — updates the current zone state.
   * Returns true if the zone changed (useful for triggering post-zone checks).
   */
  update(frame: R3EFrame): boolean {
    const zoneId = Math.floor(frame.lapDistance / ZONE_SIZE_M);

    if (this.current === null || zoneId !== this.current.zone) {
      this.previousZone = this.current?.zone ?? -1;
      this.current = {
        zone: zoneId,
        dist: zoneId * ZONE_SIZE_M,
        tcActive: frame.tcActive > 0,
        absActive: frame.absActive > 0,
        enteredAt: Date.now(),
        frameCount: 1,
      };
      return true;
    }

    // Same zone — accumulate
    this.current.frameCount++;
    if (frame.tcActive > 0) this.current.tcActive = true;
    if (frame.absActive > 0) this.current.absActive = true;

    return false;
  }

  getCurrentZone(): CurrentZone | null {
    return this.current;
  }

  getPreviousZoneId(): number {
    return this.previousZone;
  }

  reset(): void {
    this.current = null;
    this.previousZone = -1;
  }
}
