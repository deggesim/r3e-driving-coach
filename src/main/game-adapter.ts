/**
 * Game adapter — converts game-specific raw frames to the shared GameFrame interface.
 *
 * R3EFrame is a superset of GameFrame (same field names, same semantics).
 * AceReader already emits GameFrame directly, so no conversion is needed there.
 */

import type { GameFrame, R3EFrame } from '../shared/types';

/** Project an R3EFrame to the minimal GameFrame interface used by ZoneTracker and RuleEngine. */
export const toGameFrame = (frame: R3EFrame): GameFrame => ({
  lapDistance: frame.lapDistance,
  tcActive:    frame.tcActive,
  absActive:   frame.absActive,
  brakeTempFL: frame.brakeTempFL,
  brakeTempFR: frame.brakeTempFR,
  brakeTempRL: frame.brakeTempRL,
  brakeTempRR: frame.brakeTempRR,
});
