# Design: Persistenza flag leaderboard/setup-fisso per sessione

**Data:** 2026-05-20  
**Stato:** Approvato

## Problema

I toggle "Leaderboard" e "Setup fisso" in `AnalysisHeader` sono stato locale React inizializzato a `true`. Al rimontaggio del componente (cambio tab, riapertura sessione) i valori si resettano, perdendo le scelte dell'utente.

## Soluzione: Opzione A — Colonne nella tabella sessions

### 1. Schema DB

Nuove colonne aggiunte via `ALTER TABLE ... ADD COLUMN` (safe, non distruttivo su SQLite):

```sql
ALTER TABLE sessions_r3e ADD COLUMN leaderboard_mode INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions_r3e ADD COLUMN fixed_setup      INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions_ace ADD COLUMN leaderboard_mode INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions_ace ADD COLUMN fixed_setup      INTEGER NOT NULL DEFAULT 1;
```

Migrazione in `db.ts` all'avvio, con try/catch per colonne già esistenti (pattern già usato nel progetto).

Le sessioni esistenti ereditano `1`/`1` (comportamento precedente invariato).

### 2. Persistenza (main process — `main.ts`)

In `session:analyze`, prima di avviare l'analisi, aggiorno le colonne con i flag ricevuti:

```ts
db.prepare(
  `UPDATE ${t("sessions", game)} SET leaderboard_mode = ?, fixed_setup = ? WHERE id = ?`
).run(params.leaderboardMode ? 1 : 0, params.fixedSetup ? 1 : 0, sessionId);
```

Nessun nuovo IPC handler. I flag vengono salvati esattamente quando hanno effetto pratico.

### 3. Lettura nel renderer

**`types.ts` — `SessionRow`:**
```ts
leaderboard_mode?: number;  // 0 | 1
fixed_setup?: number;       // 0 | 1
```

**`AnalysisHeader.tsx` — inizializzazione state:**
```ts
const [leaderboardMode, setLeaderboardMode] = useState(
  session?.leaderboard_mode !== 0
);
const [fixedSetup, setFixedSetup] = useState(
  session?.fixed_setup !== 0
);
```

`!== 0` gestisce correttamente `undefined` (→ `true` default), `0` (→ `false`), `1` (→ `true`).

**`AnalysisHeader.tsx` — sync al cambio sessione:**
```ts
useEffect(() => {
  if (!session) return;
  setLeaderboardMode(session.leaderboard_mode !== 0);
  setFixedSetup(session.fixed_setup !== 0);
}, [session?.id]);
```

## File coinvolti

| File | Modifica |
|------|----------|
| `src/main/db/db.ts` | `ALTER TABLE` migrazione per 4 colonne |
| `src/main/main.ts` | `UPDATE` flag in `session:analyze` |
| `src/shared/types.ts` | Aggiungi `leaderboard_mode?` e `fixed_setup?` a `SessionRow` |
| `src/renderer/components/AnalysisHeader.tsx` | Init state da sessione + `useEffect` sync |

## Vincoli rispettati

- Nessun nuovo IPC handler
- Nessuna modifica allo schema delle analisi
- I toggle solo per R3E (condizione `isR3E` già esistente nel componente)
- Default `true`/`true` per sessioni esistenti e nuove (nessun breaking change)
