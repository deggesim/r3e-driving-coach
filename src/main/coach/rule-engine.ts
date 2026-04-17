/**
 * AlertDispatcher + RuleEngine
 *
 * AlertDispatcher: Priority queue, dedup per zone×type per lap, 4s silence window.
 * RuleEngine: Frame-level P1/P2, post-lap P3 from AdaptiveBaseline deviations.
 */

import { EventEmitter } from 'events';
import { ANTI_SPAM, BRAKE_TEMP } from '../../shared/alert-types.js';
import type { Alert, AlertType, Deviation, GameFrame } from '../../shared/types.js';
import type { AdaptiveBaseline } from './adaptive-baseline.js';

// --- AlertDispatcher ---

export type AlertDispatcher = {
  dispatch: (alert: Alert) => void;
  resetLap: () => void;
  on: (event: 'alert', listener: (alert: Alert) => void) => void;
};

export const createAlertDispatcher = (): AlertDispatcher => {
  const emitter = new EventEmitter();
  const firedThisLap = new Set<string>(); // "zone:type"
  let lastAlertTime = 0;
  let queue: Alert[] = [];
  let processing = false;

  const scheduleFlush = (delayMs: number): void => {
    if (processing) return;
    processing = true;
    setTimeout(() => {
      processing = false;
      flushQueue();
    }, delayMs);
  };

  const flushQueue = (): void => {
    queue.sort((a, b) => a.priority - b.priority);

    while (queue.length > 0) {
      const elapsed = Date.now() - lastAlertTime;
      if (elapsed < ANTI_SPAM.silenceWindowMs) {
        scheduleFlush(ANTI_SPAM.silenceWindowMs - elapsed);
        return;
      }

      const alert = queue.shift()!;
      const key = `${alert.zone}:${alert.type}`;
      if (firedThisLap.has(key)) continue;

      firedThisLap.add(key);
      lastAlertTime = Date.now();
      emitter.emit('alert', alert);
    }
  };

  return {
    dispatch: (alert) => {
      const key = `${alert.zone}:${alert.type}`;
      if (firedThisLap.has(key)) return;

      // P1 bypasses silence window
      if (alert.priority === 1) {
        firedThisLap.add(key);
        lastAlertTime = Date.now();
        emitter.emit('alert', alert);
        return;
      }

      const elapsed = Date.now() - lastAlertTime;
      if (elapsed < ANTI_SPAM.silenceWindowMs) {
        queue.push(alert);
        scheduleFlush(ANTI_SPAM.silenceWindowMs - elapsed);
        return;
      }

      firedThisLap.add(key);
      lastAlertTime = Date.now();
      emitter.emit('alert', alert);
    },

    resetLap: () => {
      firedThisLap.clear();
      queue = [];
    },

    on: (event, listener) => emitter.on(event, listener),
  };
};

// --- RuleEngine ---

type GetCornerNameFn = (dist: number) => string | null;

export type RuleEngine = {
  processFrame: (frame: GameFrame) => void;
  processLapDeviations: (deviations: Deviation[]) => void;
  resetLap: () => void;
};

export const createRuleEngine = (
  dispatcher: AlertDispatcher,
  baseline: AdaptiveBaseline,
  getCornerName: GetCornerNameFn,
): RuleEngine => {
  const checkBrakeTemp = (frame: GameFrame, zone: number, _location: string): void => {
    const temps = [
      { label: 'anteriore sinistro', value: frame.brakeTempFL },
      { label: 'anteriore destro', value: frame.brakeTempFR },
      { label: 'posteriore sinistro', value: frame.brakeTempRL },
      { label: 'posteriore destro', value: frame.brakeTempRR },
    ];

    for (const t of temps) {
      if (t.value === BRAKE_TEMP.unavailable) continue;

      if (t.value > BRAKE_TEMP.max) {
        dispatcher.dispatch({
          type: 'BRAKE_TEMP_CRITICAL',
          priority: 1,
          zone,
          dist: frame.lapDistance,
          message: `Freno ${t.label} a ${Math.round(t.value)} gradi — zona critica`,
          immediate: true,
          data: { temp: t.value, wheel: t.label },
          timestamp: Date.now(),
        });
      }
    }
  };

  const checkTcAbsAnomaly = (frame: GameFrame, zone: number, location: string): void => {
    const check = baseline.checkZoneRealtime({
      zone,
      tcActive: frame.tcActive > 0,
      absActive: frame.absActive > 0,
    });

    if (check.tcAnomaly) {
      dispatcher.dispatch({
        type: 'TC_ANOMALY',
        priority: 2,
        zone,
        dist: frame.lapDistance,
        message: `TC attivo a ${location} — zona insolita`,
        immediate: true,
        timestamp: Date.now(),
      });
    }

    if (check.absAnomaly) {
      dispatcher.dispatch({
        type: 'ABS_ANOMALY',
        priority: 2,
        zone,
        dist: frame.lapDistance,
        message: `ABS attivo a ${location} — zona insolita`,
        immediate: true,
        timestamp: Date.now(),
      });
    }
  };

  return {
    processFrame: (frame: GameFrame) => {
      const zone = Math.floor(frame.lapDistance / 50);
      const cornerName = getCornerName(frame.lapDistance);
      const location = cornerName
        ? `${cornerName}, metro ${Math.round(frame.lapDistance)}`
        : `metro ${Math.round(frame.lapDistance)}`;

      checkBrakeTemp(frame, zone, location);
      if (baseline.isReady()) checkTcAbsAnomaly(frame, zone, location);
    },

    processLapDeviations: (deviations) => {
      for (const dev of deviations) {
        const cornerName = getCornerName(dev.dist);
        const location = cornerName
          ? `${cornerName}, metro ${Math.round(dev.dist)}`
          : `metro ${Math.round(dev.dist)}`;

        dispatcher.dispatch({
          type: dev.type as AlertType,
          priority: 3,
          zone: dev.zone,
          dist: dev.dist,
          message: `${location}: ${dev.message}`,
          immediate: false,
          data: { delta: dev.delta },
          timestamp: Date.now(),
        });
      }
    },

    resetLap: () => dispatcher.resetLap(),
  };
};
