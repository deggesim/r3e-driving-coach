/**
 * Shared helpers for setup-row DB parsing and table name resolution.
 * Used by main.ts, session-coach.ts and voice-coach.ts to avoid duplication.
 */

import type { GameSource, SessionSetupRow, SetupData } from "../../shared/types.js";

type RawSetupRow = {
  id: number;
  session_id: number;
  loaded_at: string;
  setup_json: string;
  setup_screenshots: string | null;
};

export const tableFor = (game: GameSource, base: string): string =>
  `${base}_${game}`;

const EMPTY_SETUP: SetupData = {
  carVerified: false,
  carFound: "",
  setupText: "",
  params: [],
  screenshots: [],
};

export const parseSetupRow = (r: RawSetupRow): SessionSetupRow => {
  let setup: SetupData;
  try {
    setup = JSON.parse(r.setup_json) as SetupData;
  } catch {
    setup = { ...EMPTY_SETUP };
  }
  return {
    id: r.id,
    session_id: r.session_id,
    loaded_at: r.loaded_at,
    setup,
    setup_screenshots: r.setup_screenshots,
  };
};
