/**
 * useIPC — subscribes to Electron IPC push channels and writes to ipcStore.
 * Call once at the root; all components read state from useIPCStore directly.
 */

import { useEffect, useCallback } from "react";
import { useIPCStore } from "../store/ipcStore";
export const useIPC = (): void => {
  const setFrame = useIPCStore((s) => s.setFrame);
  const setLastLap = useIPCStore((s) => s.setLastLap);
  const setStatus = useIPCStore((s) => s.setStatus);

  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubFrame = window.electronAPI.onFrame((data) => setFrame(data));
    const unsubLap = window.electronAPI.onLapComplete((data) => setLastLap(data));
    const unsubStatus = window.electronAPI.onStatus((data) => setStatus(data));

    return () => {
      unsubFrame();
      unsubLap();
      unsubStatus();
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
