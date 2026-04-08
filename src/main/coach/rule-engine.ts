/**
 * AlertDispatcher + RuleEngine
 *
 * AlertDispatcher: Priority queue, dedup per zone×type per lap, 4s silence window.
 * RuleEngine: Frame-level P1/P2, post-lap P3 from AdaptiveBaseline deviations.
 */

import { EventEmitter } from 'events';
import { ANTI_SPAM, BRAKE_TEMP } from '../../shared/alert-types';
import type { Alert, AlertType, Deviation, R3EFrame } from '../../shared/types';
import type { AdaptiveBaseline } from './adaptive-baseline';

// --- AlertDispatcher ---

export class AlertDispatcher extends EventEmitter {
  private firedThisLap = new Set<string>(); // "zone:type"
  private lastAlertTime = 0;
  private queue: Alert[] = [];
  private processing = false;

  /**
   * Enqueue an alert. Applies dedup and silence window rules.
   */
  dispatch(alert: Alert): void {
    const key = `${alert.zone}:${alert.type}`;

    // Dedup: max 1 per (zone × type) per lap
    if (this.firedThisLap.has(key)) return;

    // P1 bypasses silence window
    if (alert.priority === 1) {
      this.firedThisLap.add(key);
      this.lastAlertTime = Date.now();
      this.emit('alert', alert);
      return;
    }

    // Silence window check
    const elapsed = Date.now() - this.lastAlertTime;
    if (elapsed < ANTI_SPAM.silenceWindowMs) {
      // Queue for later
      this.queue.push(alert);
      this.scheduleFlush(ANTI_SPAM.silenceWindowMs - elapsed);
      return;
    }

    this.firedThisLap.add(key);
    this.lastAlertTime = Date.now();
    this.emit('alert', alert);
  }

  /** Reset at start of new lap */
  resetLap(): void {
    this.firedThisLap.clear();
    this.queue = [];
  }

  private scheduleFlush(delayMs: number): void {
    if (this.processing) return;
    this.processing = true;

    setTimeout(() => {
      this.processing = false;
      this.flushQueue();
    }, delayMs);
  }

  private flushQueue(): void {
    // Sort by priority (P1 first)
    this.queue.sort((a, b) => a.priority - b.priority);

    while (this.queue.length > 0) {
      const elapsed = Date.now() - this.lastAlertTime;
      if (elapsed < ANTI_SPAM.silenceWindowMs) {
        this.scheduleFlush(ANTI_SPAM.silenceWindowMs - elapsed);
        return;
      }

      const alert = this.queue.shift()!;
      const key = `${alert.zone}:${alert.type}`;
      if (this.firedThisLap.has(key)) continue;

      this.firedThisLap.add(key);
      this.lastAlertTime = Date.now();
      this.emit('alert', alert);
    }
  }
}

// --- RuleEngine ---

type GetCornerNameFn = (dist: number) => string | null;

export class RuleEngine {
  private dispatcher: AlertDispatcher;
  private baseline: AdaptiveBaseline;
  private getCornerName: GetCornerNameFn;

  constructor(
    dispatcher: AlertDispatcher,
    baseline: AdaptiveBaseline,
    getCornerName: GetCornerNameFn,
  ) {
    this.dispatcher = dispatcher;
    this.baseline = baseline;
    this.getCornerName = getCornerName;
  }

  /**
   * Process a single frame for P1 (brake temp) and P2 (TC/ABS anomaly) alerts.
   */
  processFrame(frame: R3EFrame): void {
    const zone = Math.floor(frame.lapDistance / 50);
    const cornerName = this.getCornerName(frame.lapDistance);
    const location = cornerName
      ? `${cornerName}, metro ${Math.round(frame.lapDistance)}`
      : `metro ${Math.round(frame.lapDistance)}`;

    // P1: Brake temp critical
    this.checkBrakeTemp(frame, zone, location);

    // P2: TC/ABS in unexpected zone
    if (this.baseline.isReady) {
      this.checkTcAbsAnomaly(frame, zone, location);
    }
  }

  /**
   * Process post-lap deviations from AdaptiveBaseline for P3 alerts.
   */
  processLapDeviations(deviations: Deviation[]): void {
    for (const dev of deviations) {
      const cornerName = this.getCornerName(dev.dist);
      const location = cornerName
        ? `${cornerName}, metro ${Math.round(dev.dist)}`
        : `metro ${Math.round(dev.dist)}`;

      const alertType = dev.type as AlertType;

      this.dispatcher.dispatch({
        type: alertType,
        priority: 3,
        zone: dev.zone,
        dist: dev.dist,
        message: `${location}: ${dev.message}`,
        immediate: false,
        data: { delta: dev.delta },
        timestamp: Date.now(),
      });
    }
  }

  /** Call at start of each new lap */
  resetLap(): void {
    this.dispatcher.resetLap();
  }

  private checkBrakeTemp(frame: R3EFrame, zone: number, _location: string): void {
    const temps = [
      { label: 'anteriore sinistro', value: frame.brakeTempFL },
      { label: 'anteriore destro', value: frame.brakeTempFR },
      { label: 'posteriore sinistro', value: frame.brakeTempRL },
      { label: 'posteriore destro', value: frame.brakeTempRR },
    ];

    for (const t of temps) {
      if (t.value === BRAKE_TEMP.unavailable) continue;

      if (t.value > BRAKE_TEMP.max) {
        this.dispatcher.dispatch({
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
  }

  private checkTcAbsAnomaly(frame: R3EFrame, zone: number, location: string): void {
    const check = this.baseline.checkZoneRealtime({
      zone,
      tcActive: frame.tcActive > 0,
      absActive: frame.absActive > 0,
    });

    if (check.tcAnomaly) {
      this.dispatcher.dispatch({
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
      this.dispatcher.dispatch({
        type: 'ABS_ANOMALY',
        priority: 2,
        zone,
        dist: frame.lapDistance,
        message: `ABS attivo a ${location} — zona insolita`,
        immediate: true,
        timestamp: Date.now(),
      });
    }
  }
}
