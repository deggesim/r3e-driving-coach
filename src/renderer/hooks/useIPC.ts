/**
 * useIPC — subscribes to Electron IPC push channels and writes to ipcStore.
 * Call once at the root; all components read state from useIPCStore directly.
 */

import { useEffect, useCallback } from "react";
import { useIPCStore } from "../store/ipcStore";
import type {
  R3EFrame,
  Alert,
  LapRecord,
  GameStatus,
  LapAnalysis,
} from "../../shared/types";

export const useIPC = (): void => {
  const setFrame = useIPCStore((s) => s.setFrame);
  const setLastAlert = useIPCStore((s) => s.setLastAlert);
  const setLastLap = useIPCStore((s) => s.setLastLap);
  const setStatus = useIPCStore((s) => s.setStatus);
  const setLastAnalysis = useIPCStore((s) => s.setLastAnalysis);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onFrame((data) => setFrame(data as R3EFrame));
    window.electronAPI.onAlert((data) => setLastAlert(data as Alert));
    window.electronAPI.onLapComplete((data) => setLastLap(data as LapRecord));
    window.electronAPI.onStatus((data) => setStatus(data as GameStatus));
    window.electronAPI.onAnalysis((data) =>
      setLastAnalysis(data as LapAnalysis),
    );

    return () => {
      window.electronAPI.removeAllListeners("r3e:frame");
      window.electronAPI.removeAllListeners("r3e:alert");
      window.electronAPI.removeAllListeners("r3e:lapComplete");
      window.electronAPI.removeAllListeners("r3e:status");
      window.electronAPI.removeAllListeners("r3e:analysis");
    };
  }, [setFrame, setLastAlert, setLastLap, setStatus, setLastAnalysis]);
};

/** Config helpers — thin IPC wrappers, stable references via useCallback. */
export const useConfig = () => {
  const get = useCallback(async (key: string): Promise<string | null> => {
    if (!window.electronAPI) return null;
    const result = (await window.electronAPI.configGet(key)) as
      | { value: string }
      | undefined;
    return result?.value ?? null;
  }, []);

  const set = useCallback(async (key: string, value: string): Promise<void> => {
    if (!window.electronAPI) return;
    await window.electronAPI.configSet(key, value);
  }, []);

  return { get, set };
};
