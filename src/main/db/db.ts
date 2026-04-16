/**
 * SQLite database wrapper using better-sqlite3.
 * Schema: baseline, baseline_tc_zones, baseline_abs_zones, corner_names, sessions, laps.
 */

import Database from "better-sqlite3";
import path from "path";

let _db: Database.Database | null = null;

const initSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS baseline (
      car       TEXT NOT NULL,
      track     TEXT NOT NULL,
      zone_id   INTEGER NOT NULL,
      data      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (car, track, zone_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_tc_zones (
      car       TEXT NOT NULL,
      track     TEXT NOT NULL,
      zone_id   INTEGER NOT NULL,
      PRIMARY KEY (car, track, zone_id)
    );

    CREATE TABLE IF NOT EXISTS baseline_abs_zones (
      car       TEXT NOT NULL,
      track     TEXT NOT NULL,
      zone_id   INTEGER NOT NULL,
      PRIMARY KEY (car, track, zone_id)
    );

    CREATE TABLE IF NOT EXISTS corner_names (
      track     TEXT NOT NULL,
      layout    TEXT NOT NULL,
      dist_min  REAL NOT NULL,
      dist_max  REAL NOT NULL,
      name      TEXT NOT NULL,
      PRIMARY KEY (track, layout, dist_min)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      car          TEXT NOT NULL,
      track        TEXT NOT NULL,
      layout       TEXT NOT NULL,
      session_type TEXT NOT NULL DEFAULT 'practice',
      started_at   TEXT NOT NULL DEFAULT (datetime('now')),
      best_lap     REAL,
      lap_count    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS laps (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL REFERENCES sessions(id),
      lap_number    INTEGER NOT NULL,
      lap_time      REAL NOT NULL,
      sector1       REAL,
      sector2       REAL,
      sector3       REAL,
      valid         INTEGER NOT NULL DEFAULT 1,
      analysis_json TEXT,
      pdf_path      TEXT,
      recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_laps_session ON laps(session_id);

    CREATE TABLE IF NOT EXISTS sessions_ace (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      car          TEXT NOT NULL,
      track        TEXT NOT NULL,
      layout       TEXT NOT NULL,
      session_type TEXT NOT NULL DEFAULT 'practice',
      started_at   TEXT NOT NULL DEFAULT (datetime('now')),
      best_lap     REAL,
      lap_count    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS laps_ace (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER NOT NULL REFERENCES sessions_ace(id),
      lap_number        INTEGER NOT NULL,
      lap_time          REAL NOT NULL,
      sector1           REAL,
      sector2           REAL,
      sector3           REAL,
      valid             INTEGER NOT NULL DEFAULT 1,
      analysis_json     TEXT,
      pdf_path          TEXT,
      setup_json        TEXT,
      setup_screenshots TEXT,
      recorded_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_laps_ace_session ON laps_ace(session_id);

    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations: add setup columns if they don't exist yet
  const lapCols = db
    .prepare("PRAGMA table_info(laps)")
    .all() as Array<{ name: string }>;
  const colNames = lapCols.map((c) => c.name);
  if (!colNames.includes("setup_json")) {
    db.exec("ALTER TABLE laps ADD COLUMN setup_json TEXT");
  }
  if (!colNames.includes("setup_screenshots")) {
    db.exec("ALTER TABLE laps ADD COLUMN setup_screenshots TEXT");
  }

  // Migration: add game column to sessions (for multi-game support)
  const sessionCols = db
    .prepare("PRAGMA table_info(sessions)")
    .all() as Array<{ name: string }>;
  if (!sessionCols.map((c) => c.name).includes("game")) {
    db.exec("ALTER TABLE sessions ADD COLUMN game TEXT NOT NULL DEFAULT 'r3e'");
  }

  // Migration: add game column to baseline tables
  const baselineCols = db
    .prepare("PRAGMA table_info(baseline)")
    .all() as Array<{ name: string }>;
  if (!baselineCols.map((c) => c.name).includes("game")) {
    db.exec("ALTER TABLE baseline ADD COLUMN game TEXT NOT NULL DEFAULT 'r3e'");
  }

  const tcCols = db
    .prepare("PRAGMA table_info(baseline_tc_zones)")
    .all() as Array<{ name: string }>;
  if (!tcCols.map((c) => c.name).includes("game")) {
    db.exec("ALTER TABLE baseline_tc_zones ADD COLUMN game TEXT NOT NULL DEFAULT 'r3e'");
  }

  const absCols = db
    .prepare("PRAGMA table_info(baseline_abs_zones)")
    .all() as Array<{ name: string }>;
  if (!absCols.map((c) => c.name).includes("game")) {
    db.exec("ALTER TABLE baseline_abs_zones ADD COLUMN game TEXT NOT NULL DEFAULT 'r3e'");
  }
};

export const getDb = (userDataPath: string): Database.Database => {
  if (_db) return _db;

  const dbPath = path.join(userDataPath, "r3e-driving-coach.db");
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

/**
 * Seed corner names from the shared JSON data.
 */
export const seedCornerNames = (
  db: Database.Database,
  data: Record<
    string,
    Array<{ distMin: number; distMax: number; name: string }>
  >,
): void => {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO corner_names (track, layout, dist_min, dist_max, name)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction(
    (
      entries: Array<{
        key: string;
        distMin: number;
        distMax: number;
        name: string;
      }>,
    ) => {
      for (const entry of entries) {
        const [track, layout] = entry.key.split("|");
        insert.run(track, layout, entry.distMin, entry.distMax, entry.name);
      }
    },
  );

  const flat = Object.entries(data).flatMap(([key, corners]) =>
    corners.map((c) => ({ key, ...c })),
  );
  insertMany(flat);
};

export const closeDb = (): void => {
  if (_db) {
    _db.close();
    _db = null;
  }
};
