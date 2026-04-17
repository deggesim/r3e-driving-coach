import type { AlertPriority, AlertType } from './types.js';

/**
 * Alert type definitions with priority mapping and Italian message templates.
 */

export const ALERT_PRIORITY: Record<AlertType, AlertPriority> = {
  // P1 — Safety, immediate, interrupts all
  BRAKE_TEMP_CRITICAL: 1,

  // P2 — TC/ABS anomaly, immediate, queued
  TC_ANOMALY: 2,
  ABS_ANOMALY: 2,

  // P3 — Technique, post-corner, max 1/zone/lap
  LATE_BRAKE: 3,
  SLOW_THROTTLE: 3,
  TRAIL_BRAKING: 3,
  COASTING: 3,
  BRAKE_THROTTLE_OVERLAP: 3,
};

/** Brake temp ideal window (Celsius) */
export const BRAKE_TEMP = {
  ideal: 550,
  tolerance: 137.5,
  min: 412.5,  // 550 - 137.5
  max: 687.5,  // 550 + 137.5
  unavailable: -1,
} as const;

/** Anti-spam configuration */
export const ANTI_SPAM = {
  silenceWindowMs: 4000,
  p3MinZoneEntryDelayMs: 3000,
  maxAlertsPerZoneType: 1,
} as const;

/** Zone size in meters */
export const ZONE_SIZE_M = 50;

/** Calibration laps before baseline is ready */
export const CALIBRATION_LAPS = 2;

/** Polling interval for R3E shared memory (ms) */
export const POLL_INTERVAL_MS = 16;

/** Reconnect interval when R3E is not running (ms) */
export const RECONNECT_INTERVAL_MS = 2000;

/** EMA alpha for adaptive baseline */
export const BASELINE_EMA_ALPHA = 0.3;

/** Deviation thresholds */
export const DEVIATION_THRESHOLDS = {
  lateBrakeMeters: 15,
  slowThrottleMeters: 12,
  trailBrakingSteerDelta: 0.08,
  coastingExtraFrames: 8,
  overlapExtraFrames: 5,
} as const;

/** Qualification/Leaderboard fixed tire temp — do not flag */
export const QUALI_TIRE_TEMP_FIXED = 85;
