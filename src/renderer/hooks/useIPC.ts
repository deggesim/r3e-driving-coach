/**
 * useIPC — subscribes to Electron IPC push channels and writes to ipcStore.
 * Call once at the root; all components read state from useIPCStore directly.
 */

import { useEffect, useCallback } from "react";
import { useIPCStore } from "../store/ipcStore";
import type { R3EFrame, LapRecord, GameStatus } from "../../shared/types";

export const useIPC = (): void => {
  const setFrame = useIPCStore((s) => s.setFrame);
  const setLastLap = useIPCStore((s) => s.setLastLap);
  const setStatus = useIPCStore((s) => s.setStatus);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onFrame((data) => setFrame(data as R3EFrame));
    window.electronAPI.onLapComplete((data) => setLastLap(data as LapRecord));
    window.electronAPI.onStatus((data) => setStatus(data as GameStatus));

    return () => {
      window.electronAPI.removeAllListeners("session:frame");
      window.electronAPI.removeAllListeners("lapComplete");
      window.electronAPI.removeAllListeners("r3e:status");
    };
  }, [setFrame, setLastLap, setStatus]);
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
