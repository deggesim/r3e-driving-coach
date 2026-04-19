/**
 * ipcStore — Zustand store for Electron IPC push state.
 */

import { create } from "zustand";
import type {
  R3EFrame,
  LapRecord,
  GameStatus,
} from "../../shared/types";

const DEFAULT_STATUS: GameStatus = {
  connected: false,
  r3eConnected: false,
  aceConnected: false,
  calibrating: false,
  lapsToCalibration: 2,
  car: null,
  track: null,
  layout: null,
  game: "r3e",
};

export type IPCStore = {
  frame: R3EFrame | null;
  lastLap: LapRecord | null;
  status: GameStatus;
  setFrame: (frame: R3EFrame) => void;
  setLastLap: (lap: LapRecord) => void;
  setStatus: (status: GameStatus) => void;
};

export const useIPCStore = create<IPCStore>((set) => ({
  frame: null,
  lastLap: null,
  status: DEFAULT_STATUS,
  setFrame: (frame) => set({ frame }),
  setLastLap: (lastLap) => set({ lastLap }),
  setStatus: (status) => set({ status }),
}));
