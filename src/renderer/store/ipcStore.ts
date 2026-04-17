/**
 * ipcStore — Zustand store for Electron IPC push state.
 * Replaces local useState in useIPC hook.
 */

import { create } from "zustand";
import type {
  R3EFrame,
  Alert,
  LapRecord,
  GameStatus,
  LapAnalysis,
} from "../../shared/types";

const DEFAULT_STATUS: GameStatus = {
  connected: false,
  calibrating: false,
  lapsToCalibration: 2,
  car: null,
  track: null,
  layout: null,
  game: "r3e",
};

export type IPCStore = {
  frame: R3EFrame | null;
  lastAlert: Alert | null;
  lastLap: LapRecord | null;
  status: GameStatus;
  lastAnalysis: LapAnalysis | null;
  setFrame: (frame: R3EFrame) => void;
  setLastAlert: (alert: Alert) => void;
  setLastLap: (lap: LapRecord) => void;
  setStatus: (status: GameStatus) => void;
  setLastAnalysis: (analysis: LapAnalysis) => void;
};

export const useIPCStore = create<IPCStore>((set) => ({
  frame: null,
  lastAlert: null,
  lastLap: null,
  status: DEFAULT_STATUS,
  lastAnalysis: null,
  setFrame: (frame) => set({ frame }),
  setLastAlert: (lastAlert) => set({ lastAlert }),
  setLastLap: (lastLap) => set({ lastLap }),
  setStatus: (status) => set({ status }),
  setLastAnalysis: (lastAnalysis) => set({ lastAnalysis }),
}));
