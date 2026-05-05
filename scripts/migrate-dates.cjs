/**
 * Bonifica date DB: converte tutti i timestamp nel formato SQLite
 * "YYYY-MM-DD HH:MM:SS" (UTC) → ISO 8601 "YYYY-MM-DDTHH:MM:SS.000Z".
 *
 * Utilizzo:
 *   node scripts/migrate-dates.cjs [percorso-db]
 *
 * Se il percorso non è specificato usa il path standard di Electron:
 *   %APPDATA%\sim-driving-coach\sim-driving-coach.db
 */

"use strict";

const Database = require("better-sqlite3");
const path = require("path");
const os = require("os");
const fs = require("fs");

// --- Risolvi il percorso del DB ---
function defaultDbPath() {
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "sim-driving-coach",
      "sim-driving-coach.db",
    );
  }
  // macOS / Linux (non usati in prod, ma utili per test)
  const base =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : path.join(os.homedir(), ".config");
  return path.join(base, "sim-driving-coach", "sim-driving-coach.db");
}

const dbPath = process.argv[2] ?? defaultDbPath();

if (!fs.existsSync(dbPath)) {
  console.error(`DB non trovato: ${dbPath}`);
  process.exit(1);
}

console.log(`DB: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// --- Tabelle e colonne da bonificare ---
// Formato attuale: "YYYY-MM-DD HH:MM:SS"  (UTC, da datetime('now'))
// Formato target:  "YYYY-MM-DDTHH:MM:SS.000Z"
const TARGETS = [
  { table: "sessions_r3e",        cols: ["started_at", "ended_at"] },
  { table: "sessions_ace",        cols: ["started_at", "ended_at"] },
  { table: "session_setups_r3e",  cols: ["loaded_at"] },
  { table: "session_setups_ace",  cols: ["loaded_at"] },
  { table: "laps_r3e",            cols: ["recorded_at"] },
  { table: "laps_ace",            cols: ["recorded_at"] },
  { table: "session_analyses_r3e", cols: ["created_at"] },
  { table: "session_analyses_ace", cols: ["created_at"] },
  { table: "baseline",            cols: ["updated_at"] },
  { table: "track_maps",          cols: ["created_at"] },
];

// Controlla se una tabella esiste
function tableExists(name) {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return !!row;
}

// Converte "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS.000Z"
// Se il valore è già in formato ISO (contiene 'T') lo lascia invariato.
function migrateColumn(table, col) {
  if (!tableExists(table)) {
    console.log(`  Tabella ${table} non trovata, skip.`);
    return 0;
  }

  // Conta le righe da convertire (non contengono 'T', non sono NULL)
  const { count } = db
    .prepare(
      `SELECT COUNT(*) AS count FROM "${table}"
       WHERE "${col}" IS NOT NULL AND "${col}" NOT LIKE '%T%'`,
    )
    .get();

  if (count === 0) {
    console.log(`  ${table}.${col}: nessuna riga da convertire.`);
    return 0;
  }

  // Aggiorna in-place: sostituisce lo spazio con 'T' e aggiunge '.000Z'
  const info = db
    .prepare(
      `UPDATE "${table}"
       SET "${col}" = REPLACE("${col}", ' ', 'T') || '.000Z'
       WHERE "${col}" IS NOT NULL AND "${col}" NOT LIKE '%T%'`,
    )
    .run();

  console.log(`  ${table}.${col}: convertite ${info.changes} righe.`);
  return info.changes;
}

// Esegui la bonifica in una singola transazione
const migrate = db.transaction(() => {
  let total = 0;
  for (const { table, cols } of TARGETS) {
    for (const col of cols) {
      total += migrateColumn(table, col);
    }
  }
  return total;
});

console.log("\nAvvio bonifica date...");
const total = migrate();
console.log(`\nBonifica completata. Righe aggiornate: ${total}`);

db.close();
