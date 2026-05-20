# Persist Session Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistere i flag `leaderboard_mode` e `fixed_setup` per-sessione in SQLite, in modo che alla riapertura di una sessione i toggle di `AnalysisHeader` vengano ripristinati ai valori usati nell'ultima analisi.

**Architecture:** Nuove colonne `leaderboard_mode` e `fixed_setup` (INTEGER DEFAULT 1) sulle tabelle `sessions_r3e` e `sessions_ace`. Vengono scritte nel handler `session:analyze` prima di avviare l'analisi. Vengono lette attraverso `enrichSession` che popola `SessionRow`, già inviata al renderer via push IPC ad ogni apertura/riapertura sessione. `AnalysisHeader` inizializza il proprio state locale da `session.leaderboard_mode` / `session.fixed_setup` e lo sincronizza tramite `useEffect` al cambio di sessione.

**Tech Stack:** TypeScript, better-sqlite3 (SQLite), React 18 + Zustand, Electron IPC.

---

## File Map

| File | Tipo | Modifica |
|------|------|----------|
| `src/main/db/db.ts` | Modifica | Aggiunge migrazione `ALTER TABLE` per 4 colonne |
| `src/shared/types.ts` | Modifica | Aggiunge `leaderboard_mode?` e `fixed_setup?` a `SessionRow` |
| `src/main/main.ts` | Modifica | Aggiorna `enrichSession` + aggiunge `UPDATE` in `session:analyze` |
| `src/renderer/components/AnalysisHeader.tsx` | Modifica | Inizializza state da sessione + `useEffect` sync |

---

## Task 1: Migrazione schema DB

**Files:**
- Modify: `src/main/db/db.ts` (funzione `initSchema`, dopo la `db.exec(...)`)

- [ ] **Step 1: Aggiungi la migrazione in `db.ts`**

  Dopo la chiamata `initSchema(_db)` nella funzione `getDb` (riga ~231), NON modificare `initSchema`. Aggiungi invece una funzione separata `migrateSchema` e chiamala dopo `initSchema`:

  ```ts
  // Inserire PRIMA di "return _db;" in getDb(), dopo initSchema(_db):
  migrateSchema(_db);
  ```

  Aggiungi la funzione `migrateSchema` subito dopo `initSchema`:

  ```ts
  const migrateSchema = (db: Database.Database): void => {
    const migrations: string[] = [
      `ALTER TABLE sessions_r3e ADD COLUMN leaderboard_mode INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE sessions_r3e ADD COLUMN fixed_setup      INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE sessions_ace ADD COLUMN leaderboard_mode INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE sessions_ace ADD COLUMN fixed_setup      INTEGER NOT NULL DEFAULT 1`,
    ];
    for (const sql of migrations) {
      try {
        db.prepare(sql).run();
      } catch {
        // Colonna già esistente — ignorato
      }
    }
  };
  ```

- [ ] **Step 2: Verifica typecheck**

  ```bash
  npm run typecheck
  ```

  Atteso: nessun errore.

- [ ] **Step 3: Commit**

  ```bash
  git add src/main/db/db.ts
  git commit -m "feat(db): add leaderboard_mode and fixed_setup columns to sessions tables"
  ```

---

## Task 2: Aggiorna il tipo `SessionRow`

**Files:**
- Modify: `src/shared/types.ts` (tipo `SessionRow`, righe 190-207)

- [ ] **Step 1: Aggiungi i due campi a `SessionRow`**

  Apri `src/shared/types.ts`. Nel tipo `SessionRow` (inizia a riga 190), aggiungi i due campi opzionali in fondo alla lista dei campi esistenti, prima della chiusura `}`:

  ```ts
  // Aggiungere dopo analysis_count?:
  leaderboard_mode?: number;  // 0 | 1 — salvato all'ultima analisi
  fixed_setup?: number;       // 0 | 1 — salvato all'ultima analisi
  ```

  Il tipo `SessionRow` completo dopo la modifica sarà:

  ```ts
  export type SessionRow = {
    id: number;
    game: GameSource;
    car: string;
    track: string;
    layout: string;
    session_type: string;
    started_at: string;
    ended_at: string | null;
    best_lap: number | null;
    lap_count: number;
    // Resolved display names (populated by queries)
    car_name?: string;
    track_name?: string;
    layout_name?: string;
    car_class_name?: string;
    analysis_count?: number;
    leaderboard_mode?: number;
    fixed_setup?: number;
  };
  ```

- [ ] **Step 2: Verifica typecheck**

  ```bash
  npm run typecheck
  ```

  Atteso: nessun errore.

- [ ] **Step 3: Commit**

  ```bash
  git add src/shared/types.ts
  git commit -m "feat(types): add leaderboard_mode and fixed_setup to SessionRow"
  ```

---

## Task 3: Popola i flag in `enrichSession` e salvali in `session:analyze`

**Files:**
- Modify: `src/main/main.ts`
  - `enrichSession` (righe ~247-275): aggiunge i due campi al return
  - `session:analyze` handler (righe ~969-1010): aggiunge `UPDATE` prima di avviare l'analisi

- [ ] **Step 1: Aggiorna `enrichSession` per includere i flag**

  Nel return object di `enrichSession` (dopo `analysis_count: ...`), aggiungi:

  ```ts
  leaderboard_mode:
    typeof row.leaderboard_mode === "number" ? row.leaderboard_mode : 1,
  fixed_setup:
    typeof row.fixed_setup === "number" ? row.fixed_setup : 1,
  ```

  Il return completo di `enrichSession` diventa:

  ```ts
  return {
    id: row.id as number,
    game,
    car: row.car as string,
    track: row.track as string,
    layout: row.layout as string,
    session_type: row.session_type as string,
    started_at: row.started_at as string,
    ended_at: (row.ended_at as string | null) ?? null,
    best_lap: (row.best_lap as number | null) ?? null,
    lap_count: row.lap_count as number,
    car_name: names.carName,
    track_name: names.trackName,
    layout_name: names.layoutName,
    car_class_name: names.carClassName,
    analysis_count:
      typeof row.analysis_count === "number" ? row.analysis_count : undefined,
    leaderboard_mode:
      typeof row.leaderboard_mode === "number" ? row.leaderboard_mode : 1,
    fixed_setup:
      typeof row.fixed_setup === "number" ? row.fixed_setup : 1,
  };
  ```

- [ ] **Step 2: Aggiungi `UPDATE` in `session:analyze`**

  Nel handler `session:analyze` (riga ~1003), dopo la riga:
  ```ts
  const flags = { leaderboardMode: params.leaderboardMode, fixedSetup: params.fixedSetup };
  ```

  Aggiungi l'UPDATE (prima di `analyzingInProgress.add(analyzeKey)`):

  ```ts
  db.prepare(
    `UPDATE ${t("sessions", game)} SET leaderboard_mode = ?, fixed_setup = ? WHERE id = ?`,
  ).run(params.leaderboardMode ? 1 : 0, params.fixedSetup ? 1 : 0, sessionId);
  ```

- [ ] **Step 3: Verifica typecheck**

  ```bash
  npm run typecheck
  ```

  Atteso: nessun errore.

- [ ] **Step 4: Commit**

  ```bash
  git add src/main/main.ts
  git commit -m "feat(main): persist and restore leaderboard_mode/fixed_setup flags per session"
  ```

---

## Task 4: Inizializza i toggle di `AnalysisHeader` dalla sessione

**Files:**
- Modify: `src/renderer/components/AnalysisHeader.tsx` (righe 1-157)

- [ ] **Step 1: Aggiungi l'import di `useEffect`**

  Alla riga 1, modifica l'import da React:

  ```ts
  import { useState, useEffect } from "react";
  ```

- [ ] **Step 2: Sostituisci l'inizializzazione dello state**

  Sostituisci le righe 48-49:
  ```ts
  const [leaderboardMode, setLeaderboardMode] = useState(true);
  const [fixedSetup, setFixedSetup] = useState(true);
  ```

  Con:
  ```ts
  const [leaderboardMode, setLeaderboardMode] = useState(
    session?.leaderboard_mode !== 0,
  );
  const [fixedSetup, setFixedSetup] = useState(
    session?.fixed_setup !== 0,
  );
  ```

  `!== 0` gestisce correttamente:
  - `undefined` → `true` (default per sessioni senza analisi o sessioni ACE)
  - `0` → `false`
  - `1` → `true`

- [ ] **Step 3: Aggiungi il `useEffect` di sincronizzazione**

  Dopo le due righe `useState` appena modificate, aggiungi:

  ```ts
  useEffect(() => {
    if (!session) return;
    setLeaderboardMode(session.leaderboard_mode !== 0);
    setFixedSetup(session.fixed_setup !== 0);
  }, [session?.id]);
  ```

  Questo aggiorna i toggle quando l'utente naviga tra sessioni diverse (cambia `session.id`) senza rimontare `AnalysisHeader`.

- [ ] **Step 4: Verifica typecheck**

  ```bash
  npm run typecheck
  ```

  Atteso: nessun errore.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/components/AnalysisHeader.tsx
  git commit -m "feat(ui): restore leaderboard/fixed-setup toggles from session on reopen"
  ```

---

## Verifica manuale end-to-end

- [ ] **Avvia l'app in dev**

  ```bash
  npm run dev
  ```

- [ ] **Test caso principale**
  1. Apri una sessione R3E
  2. Imposta `Leaderboard = OFF`, `Setup fisso = OFF`
  3. Clicca "Esegui analisi"
  4. Chiudi la sessione
  5. Vai in "Storico sessioni", trova la sessione appena chiusa
  6. Clicca "Riapri sessione"
  7. Verifica: i toggle mostrano `Leaderboard = OFF`, `Setup fisso = OFF`

- [ ] **Test default (prima analisi)**
  1. Apri una nuova sessione R3E senza mai eseguire analisi
  2. Verifica: i toggle partono entrambi a `ON` (default)

- [ ] **Test sessione ACE**
  - I toggle non appaiono per le sessioni ACE (`isR3E` è false): verifica che non siano visibili
