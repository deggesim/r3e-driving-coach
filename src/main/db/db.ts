import Database from "better-sqlite3";
import path from "path";
import type { GameSource, TrackMapGeometry, ZoneData } from "../../shared/types.js";

let _db: Database.Database | null = null;

const initSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS baseline (
      game      TEXT NOT NULL DEFAULT 'r3e',
      car       TEXT NOT NULL,
      track     TEXT NOT NULL,
      zone_id   INTEGER NOT NULL,
      data      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (game, car, track, zone_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_tc_zones (
      game      TEXT NOT NULL DEFAULT 'r3e',
      car       TEXT NOT NULL,
      track     TEXT NOT NULL,
      zone_id   INTEGER NOT NULL,
      PRIMARY KEY (game, car, track, zone_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_abs_zones (
      game      TEXT NOT NULL DEFAULT 'r3e',
      car       TEXT NOT NULL,
      track     TEXT NOT NULL,
      zone_id   INTEGER NOT NULL,
      PRIMARY KEY (game, car, track, zone_id)
    );

    CREATE TABLE IF NOT EXISTS corner_names (
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

    CREATE TABLE IF NOT EXISTS track_maps (
      game       TEXT NOT NULL,
      car        TEXT NOT NULL,
      track      TEXT NOT NULL,
      layout     TEXT NOT NULL,
      geometry   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (game, car, track, layout)
    );
  `);

  // Migration: add frames_blob to pre-existing laps_* tables
  const hasColumn = (table: string, column: string): boolean => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  };
  if (!hasColumn("laps_r3e", "frames_blob")) {
    db.exec(`ALTER TABLE laps_r3e ADD COLUMN frames_blob BLOB`);
  }
  if (!hasColumn("laps_ace", "frames_blob")) {
    db.exec(`ALTER TABLE laps_ace ADD COLUMN frames_blob BLOB`);
  }

  // Migration: invalidate R3E laps where any sector was stored as 0 (not counted by the sim).
  // Zero sectors indicate an incomplete lap recorded before R3E populated the SHM sector fields.
  db.exec(`
    UPDATE laps_r3e
    SET valid = 0
    WHERE valid = 1
      AND (sector1 <= 0 OR sector1 IS NULL
        OR sector2 <= 0 OR sector2 IS NULL
        OR sector3 <= 0 OR sector3 IS NULL)
  `);

  // Migration: recompute best_lap from valid laps only (previously invalid laps could overwrite it).
  for (const game of ["r3e", "ace"] as const) {
    db.exec(`
      UPDATE sessions_${game}
      SET best_lap = (
        SELECT MIN(lap_time) FROM laps_${game}
        WHERE session_id = sessions_${game}.id AND valid = 1
      )
    `);
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
 * Look up the official corner name for a given track distance.
 * Returns null if no corner is mapped at that distance.
 */
export const getCornerName = (
  db: Database.Database,
  track: string,
  layout: string,
  dist: number,
): string | null => {
  const row = db
    .prepare(
      `
    SELECT name FROM corner_names
    WHERE track = ? AND layout = ? AND dist_min <= ? AND dist_max >= ?
    LIMIT 1
  `,
    )
    .get(track, layout, dist, dist) as { name: string } | undefined;

  return row?.name ?? null;
};

export const hasCornerNames = (
  db: Database.Database,
  track: string,
  layout: string,
): boolean => {
  const row = db
    .prepare(
      "SELECT 1 FROM corner_names WHERE track = ? AND layout = ? LIMIT 1",
    )
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
  track: string,
  layout: string,
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

  const insert = db.prepare(`
    INSERT OR IGNORE INTO corner_names (track, layout, dist_min, dist_max, name)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    groups.forEach((g, i) => {
      insert.run(track, layout, g.start * ZONE_M, (g.end + 1) * ZONE_M, `Curva ${i + 1}`);
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
  car: string,
  track: string,
  layout: string,
): TrackMapGeometry | null => {
  const row = db
    .prepare(
      `SELECT geometry FROM track_maps
       WHERE game = ? AND car = ? AND track = ? AND layout = ?`,
    )
    .get(game, car, track, layout) as { geometry: string } | undefined;
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
  car: string,
  track: string,
  layout: string,
  geometry: TrackMapGeometry,
): void => {
  db.prepare(
    `INSERT OR REPLACE INTO track_maps (game, car, track, layout, geometry, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(game, car, track, layout, JSON.stringify(geometry));
};

export const closeDb = (): void => {
  if (_db) {
    _db.close();
    _db = null;
  }
};
