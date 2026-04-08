/**
 * useIPC — React hook that subscribes to Electron IPC push channels.
 * Wraps window.electronAPI (exposed via preload contextBridge).
 */

import { useEffect, useState, useCallback } from 'react';
import type { R3EFrame, Alert, LapRecord, R3EStatus, LapAnalysis } from '../../shared/types';

export type IPCState = {
  frame: R3EFrame | null;
  lastAlert: Alert | null;
  lastLap: LapRecord | null;
  status: R3EStatus;
  lastAnalysis: LapAnalysis | null;
};

const DEFAULT_STATUS: R3EStatus = {
  connected: false,
  calibrating: false,
  lapsToCalibration: 2,
  car: null,
  track: null,
  layout: null,
};

export function useIPC(): IPCState {
  const [frame, setFrame] = useState<R3EFrame | null>(null);
  const [lastAlert, setLastAlert] = useState<Alert | null>(null);
  const [lastLap, setLastLap] = useState<LapRecord | null>(null);
  const [status, setStatus] = useState<R3EStatus>(DEFAULT_STATUS);
  const [lastAnalysis, setLastAnalysis] = useState<LapAnalysis | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onFrame((data) => setFrame(data));
    window.electronAPI.onAlert((data) => setLastAlert(data));
    window.electronAPI.onLapComplete((data) => setLastLap(data));
    window.electronAPI.onStatus((data) => setStatus(data));
    window.electronAPI.onAnalysis((data) => setLastAnalysis(data));

    return () => {
      window.electronAPI.removeAllListeners('r3e:frame');
      window.electronAPI.removeAllListeners('r3e:alert');
      window.electronAPI.removeAllListeners('r3e:lapComplete');
      window.electronAPI.removeAllListeners('r3e:status');
      window.electronAPI.removeAllListeners('r3e:analysis');
    };
  }, []);

  return { frame, lastAlert, lastLap, status, lastAnalysis };
}

/** Config helpers */
export function useConfig() {
  const get = useCallback(async (key: string): Promise<string | null> => {
    if (!window.electronAPI) return null;
    const result = await window.electronAPI.configGet(key) as { value: string } | undefined;
    return result?.value ?? null;
  }, []);

  const set = useCallback(async (key: string, value: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.configSet(key, value);
  }, []);

  return { get, set };
}
