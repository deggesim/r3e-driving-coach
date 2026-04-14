/**
 * R3EDataLoader — Loads r3e-data.json from the R3E game installation.
 *
 * Provides ID → name lookups for cars, tracks, and layouts.
 * Used to resolve numeric IDs (from shared memory) to human-readable names
 * for display in the UI and Claude API prompts, while the database always
 * references entities by their numeric ID.
 */

import fs from "fs";

const R3E_DATA_PATH =
  "C:/Program Files (x86)/Steam/steamapps/common/raceroom racing experience/Game/GameData/General/r3e-data.json";

type R3ECarEntry = {
  Id: number;
  Name: string;
  BrandName: string;
  Class: number;
};

type R3ELayoutEntry = {
  Id: number;
  Name: string;
  Track: number;
  MaxNumberOfVehicles: number;
};

type R3ETrackEntry = {
  Id: number;
  Name: string;
  layouts: R3ELayoutEntry[];
};

type R3EClassEntry = {
  Id: number;
  Name: string;
};

type R3EDataFile = {
  cars: Record<string, R3ECarEntry>;
  tracks: Record<string, R3ETrackEntry>;
  layouts: Record<string, R3ELayoutEntry>;
  classes?: Record<string, R3EClassEntry>;
};

let data: R3EDataFile | null = null;

/**
 * Attempt to load r3e-data.json from the default R3E installation path.
 * Returns true on success, false if the file is missing or malformed.
 */
export const loadR3EData = (): boolean => {
  try {
    const raw = fs.readFileSync(R3E_DATA_PATH, "utf-8");
    data = JSON.parse(raw) as R3EDataFile;
    const carCount = Object.keys(data.cars ?? {}).length;
    const trackCount = Object.keys(data.tracks ?? {}).length;
    console.log(
      `[R3EData] Loaded: ${carCount} cars, ${trackCount} tracks`,
    );
    return true;
  } catch (err) {
    console.warn(`[R3EData] Could not load r3e-data.json: ${String(err)}`);
    return false;
  }
};

export const isR3EDataLoaded = (): boolean => data !== null;

/**
 * Resolve a car model ID to its display name.
 * Falls back to the raw ID string if data not loaded or ID not found.
 */
export const getCarName = (id: number): string =>
  data?.cars[String(id)]?.Name ?? String(id);

/**
 * Resolve a track ID to its display name.
 * Falls back to the raw ID string if data not loaded or ID not found.
 */
export const getTrackName = (id: number): string =>
  data?.tracks[String(id)]?.Name ?? String(id);

/**
 * Resolve a layout ID to its display name.
 * Falls back to the raw ID string if data not loaded or ID not found.
 */
export const getLayoutName = (id: number): string =>
  data?.layouts[String(id)]?.Name ?? String(id);

/**
 * Resolve a car's class ID to its display name.
 * Falls back to an empty string if data not loaded or class not found.
 */
export const getCarClassName = (carId: number): string => {
  const classId = data?.cars[String(carId)]?.Class;
  if (classId === undefined) return "";
  return data?.classes?.[String(classId)]?.Name ?? "";
};
