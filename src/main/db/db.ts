import Database from "better-sqlite3";
import path from "path";
import type {
  GameSource,
  TrackMapGeometry,
  ZoneData,
} from "../../shared/types.js";
import { R3E_CORNERS } from "./r3e-corners.js";

let _db: Database.Database | null = null;

const seedR3ECorners = (db: Database.Database): void => {
  const count = (
    db.prepare(`SELECT COUNT(*) as n FROM corner_names_r3e`).get() as { n: number }
  ).n;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO corner_names_r3e (track, layout, dist_min, dist_max, name) VALUES (?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const c of R3E_CORNERS) {
      insert.run(c.track, c.layout, c.distMin, c.distMax, c.name);
    }
  })();
  console.log(`[DB] Seeded ${R3E_CORNERS.length} R3E corner entries`);
};

const initSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS baseline_r3e (
      car       INTEGER NOT NULL,
      track     INTEGER NOT NULL,
      layout    INTEGER NOT NULL,
      zone_id   INTEGER NOT NULL,
      data      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (car, track, layout, zone_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_ace (
      car       TEXT NOT NULL,
      track     TEXT NOT NULL,
      layout    TEXT NOT NULL,
      zone_id   INTEGER NOT NULL,
      data      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (car, track, layout, zone_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_tc_zones_r3e (
      car       INTEGER NOT NULL,
      track     INTEGER NOT NULL,
      layout    INTEGER NOT NULL,
      zone_id   INTEGER NOT NULL,
      PRIMARY KEY (car, track, layout, zone_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_tc_zones_ace (
      car       TEXT NOT NULL,
      track     TEXT NOT NULL,
      layout    TEXT NOT NULL,
      zone_id   INTEGER NOT NULL,
      PRIMARY KEY (car, track, layout, zone_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_abs_zones_r3e (
      car       INTEGER NOT NULL,
      track     INTEGER NOT NULL,
      layout    INTEGER NOT NULL,
      zone_id   INTEGER NOT NULL,
      PRIMARY KEY (car, track, layout, zone_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_abs_zones_ace (
      car       TEXT NOT NULL,
      track     TEXT NOT NULL,
      layout    TEXT NOT NULL,
      zone_id   INTEGER NOT NULL,
      PRIMARY KEY (car, track, layout, zone_id)
    );

    CREATE TABLE IF NOT EXISTS corner_names_r3e (
      track     INTEGER NOT NULL,
      layout    INTEGER NOT NULL,
      dist_min  REAL NOT NULL,
      dist_max  REAL NOT NULL,
      name      TEXT NOT NULL,
      PRIMARY KEY (track, layout, dist_min)
    );

    CREATE TABLE IF NOT EXISTS corner_names_ace (
      track     TEXT NOT NULL,
      layout    TEXT NOT NULL,
      dist_min  REAL NOT NULL,
      dist_max  REAL NOT NULL,
      name      TEXT NOT NULL,
      PRIMARY KEY (track, layout, dist_min)
    );

    CREATE TABLE IF NOT EXISTS sessions_r3e (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      car          TEXT NOT NULL,
      track        TEXT NOT NULL,
      layout       TEXT NOT NULL,
      session_type TEXT NOT NULL DEFAULT 'practice',
      started_at   TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at     TEXT,
      best_lap     REAL,
      lap_count    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS session_setups_r3e (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER NOT NULL REFERENCES sessions_r3e(id) ON DELETE CASCADE,
      loaded_at         TEXT NOT NULL DEFAULT (datetime('now')),
      setup_json        TEXT NOT NULL,
      setup_screenshots TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_setups_r3e_session ON session_setups_r3e(session_id);

    CREATE TABLE IF NOT EXISTS laps_r3e (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL REFERENCES sessions_r3e(id) ON DELETE CASCADE,
      setup_id      INTEGER REFERENCES session_setups_r3e(id) ON DELETE SET NULL,
      lap_number    INTEGER NOT NULL,
      lap_time      REAL NOT NULL,
      sector1       REAL,
      sector2       REAL,
      sector3       REAL,
      valid         INTEGER NOT NULL DEFAULT 1,
      zones_json    TEXT,
      frames_blob   BLOB,
      recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_laps_r3e_session ON laps_r3e(session_id);

    CREATE TABLE IF NOT EXISTS session_analyses_r3e (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER NOT NULL REFERENCES sessions_r3e(id) ON DELETE CASCADE,
      version           INTEGER NOT NULL,
      template_v3       TEXT NOT NULL,
      section5_summary  TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_analyses_r3e_session ON session_analyses_r3e(session_id);

    CREATE TABLE IF NOT EXISTS sessions_ace (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      car          TEXT NOT NULL,
      track        TEXT NOT NULL,
      layout       TEXT NOT NULL,
      session_type TEXT NOT NULL DEFAULT 'practice',
      started_at   TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at     TEXT,
      best_lap     REAL,
      lap_count    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS session_setups_ace (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER NOT NULL REFERENCES sessions_ace(id) ON DELETE CASCADE,
      loaded_at         TEXT NOT NULL DEFAULT (datetime('now')),
      setup_json        TEXT NOT NULL,
      setup_screenshots TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_setups_ace_session ON session_setups_ace(session_id);

    CREATE TABLE IF NOT EXISTS laps_ace (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL REFERENCES sessions_ace(id) ON DELETE CASCADE,
      setup_id      INTEGER REFERENCES session_setups_ace(id) ON DELETE SET NULL,
      lap_number    INTEGER NOT NULL,
      lap_time      REAL NOT NULL,
      sector1       REAL,
      sector2       REAL,
      sector3       REAL,
      valid         INTEGER NOT NULL DEFAULT 1,
      zones_json    TEXT,
      frames_blob   BLOB,
      recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_laps_ace_session ON laps_ace(session_id);

    CREATE TABLE IF NOT EXISTS session_analyses_ace (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER NOT NULL REFERENCES sessions_ace(id) ON DELETE CASCADE,
      version           INTEGER NOT NULL,
      template_v3       TEXT NOT NULL,
      section5_summary  TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_analyses_ace_session ON session_analyses_ace(session_id);

    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_maps_r3e (
      car        INTEGER NOT NULL,
      track      INTEGER NOT NULL,
      layout     INTEGER NOT NULL,
      geometry   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (car, track, layout)
    );

    CREATE TABLE IF NOT EXISTS track_maps_ace (
      car        TEXT NOT NULL,
      track      TEXT NOT NULL,
      layout     TEXT NOT NULL,
      geometry   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (car, track, layout)
    );
  `);

  seedR3ECorners(db);

  // Migration: copy data from the old unified track_maps table (pre-6c73b79) to game-specific tables
  const oldTrackMaps = db.prepare(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='track_maps'`,
  ).get() as { n: number };
  if (oldTrackMaps.n > 0) {
    try {
      db.exec(`
        INSERT OR IGNORE INTO track_maps_ace (car, track, layout, geometry, created_at)
        SELECT car, track, layout, geometry, created_at FROM track_maps WHERE game = 'ace';

        INSERT OR IGNORE INTO track_maps_r3e (car, track, layout, geometry, created_at)
        SELECT CAST(car AS INTEGER), CAST(track AS INTEGER), CAST(layout AS INTEGER), geometry, created_at FROM track_maps WHERE game = 'r3e';
      `);
      console.log('[DB] Migrated track_maps → track_maps_r3e / track_maps_ace');
    } catch (err) {
      console.error('[DB] track_maps migration error:', err);
    }
  }
};

export const getDb = (userDataPath: string): Database.Database => {
  if (_db) return _db;

  const dbPath = path.join(userDataPath, "sim-driving-coach.db");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  initSchema(_db);
  return _db;
};

/**
 * Seeds corner names for an ACE session from R3E_CORNERS using exact track+layout match.
 * No mapping table — only writes rows when ACE track and layout strings match exactly.
 * No-op if corners are already present or if no exact match exists in R3E_CORNERS.
 */
export const seedAceCornersFromR3E = (
  db: Database.Database,
  aceTrack: string,
  aceLayout: string,
): void => {
  if (hasCornerNames(db, "ace", aceTrack, aceLayout)) return;

  // R3E_CORNERS now uses numeric IDs — ACE matching is not possible via this path.
  // ACE corner names are seeded via seedCornersFromLap instead.
};

/**
 * Look up the official corner name for a given track distance.
 * Returns null if no corner is mapped at that distance.
 */
export const getCornerName = (
  db: Database.Database,
  game: GameSource,
  track: number | string,
  layout: number | string,
  dist: number,
): string | null => {
  const table = game === "r3e" ? "corner_names_r3e" : "corner_names_ace";
  const row = db
    .prepare(
      `SELECT name FROM ${table}
       WHERE track = ? AND layout = ? AND dist_min <= ? AND dist_max >= ?
       LIMIT 1`,
    )
    .get(track, layout, dist, dist) as { name: string } | undefined;

  return row?.name ?? null;
};

export const hasCornerNames = (
  db: Database.Database,
  game: GameSource,
  track: number | string,
  layout: number | string,
): boolean => {
  const table = game === "r3e" ? "corner_names_r3e" : "corner_names_ace";
  const row = db
    .prepare(`SELECT 1 FROM ${table} WHERE track = ? AND layout = ? LIMIT 1`)
    .get(track, layout);
  return row !== undefined;
};

/**
 * Derive corner names from the first lap's zone data.
 * Zones with significant braking (maxBrakePct >= 0.2) are grouped into corners
 * and named "Curva 1", "Curva 2", etc. by distance order.
 */
export const seedCornersFromLap = (
  db: Database.Database,
  game: GameSource,
  track: number | string,
  layout: number | string,
  zones: ZoneData[],
): void => {
  const ZONE_M = 50;
  const BRAKE_THRESHOLD = 0.2;

  const brakingZones = zones
    .filter((z) => z.maxBrakePct >= BRAKE_THRESHOLD)
    .map((z) => z.zone)
    .sort((a, b) => a - b);

  if (brakingZones.length === 0) return;

  // Group consecutive zone IDs (gap ≤ 2 allowed to bridge short coasting frames)
  const groups: Array<{ start: number; end: number }> = [];
  let current: { start: number; end: number } | null = null;
  for (const zoneId of brakingZones) {
    if (!current) {
      current = { start: zoneId, end: zoneId };
    } else if (zoneId <= current.end + 2) {
      current.end = zoneId;
    } else {
      groups.push(current);
      current = { start: zoneId, end: zoneId };
    }
  }
  if (current) groups.push(current);

  const table = game === "r3e" ? "corner_names_r3e" : "corner_names_ace";
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ${table} (track, layout, dist_min, dist_max, name)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    groups.forEach((g, i) => {
      insert.run(
        track,
        layout,
        g.start * ZONE_M,
        (g.end + 1) * ZONE_M,
        `Curva ${i + 1}`,
      );
    });
  })();

  console.log(`[DB] Seeded ${groups.length} corner(s) for ${track}|${layout}`);
};

/**
 * Track map persistence (one geometry per game/car/track/layout).
 */
export const getTrackMap = (
  db: Database.Database,
  game: GameSource,
  car: number | string,
  track: number | string,
  layout: number | string,
): TrackMapGeometry | null => {
  const table = game === "r3e" ? "track_maps_r3e" : "track_maps_ace";
  const row = db
    .prepare(
      `SELECT geometry FROM ${table} WHERE car = ? AND track = ? AND layout = ?`,
    )
    .get(car, track, layout) as { geometry: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.geometry) as TrackMapGeometry;
  } catch {
    return null;
  }
};

export const saveTrackMap = (
  db: Database.Database,
  game: GameSource,
  car: number | string,
  track: number | string,
  layout: number | string,
  geometry: TrackMapGeometry,
): void => {
  const table = game === "r3e" ? "track_maps_r3e" : "track_maps_ace";
  db.prepare(
    `INSERT OR REPLACE INTO ${table} (car, track, layout, geometry, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(car, track, layout, JSON.stringify(geometry), new Date().toISOString());
};

export const closeDb = (): void => {
  if (_db) {
    _db.close();
    _db = null;
  }
};
