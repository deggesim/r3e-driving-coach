import Database from "better-sqlite3";
import path from "path";

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
      best_lap     REAL,
      lap_count    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS laps_r3e (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL REFERENCES sessions_r3e(id),
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

    CREATE INDEX IF NOT EXISTS idx_laps_session ON laps_r3e(session_id);

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
