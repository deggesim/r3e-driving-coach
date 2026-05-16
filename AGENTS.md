# AGENTS.md

## Project Overview

**Sim Driving Coach** is an Electron + React desktop application (Windows only) that acts as a real-time voice coach for sim racing. It reads shared memory from **RaceRoom Racing Experience (R3E)** and **Assetto Corsa EVO (ACE)**, analyzes driving technique, fires Italian-language voice alerts during laps, and on demand calls the Claude API for a full session debriefing in Template v3 format.

Key technologies: Electron 41, React 19, TypeScript strict mode, Vite, Zustand, better-sqlite3, koffi (FFI for shared memory), Azure Cognitive Services TTS/STT, Anthropic SDK.

All voice output and UI text are in **Italian**. Code, comments, and identifiers are in **English**.

## Setup Commands

```bash
# Install dependencies
npm install

# Rebuild native modules for Electron (required after install and after Electron version changes)
npm run rebuild:native

# Start development (Vite + Electron concurrently)
npm run dev

# Production build (renderer + main process)
npm run build

# Package distributable (runs build first)
npm run build:electron
```

> `better-sqlite3` is a native module and must be rebuilt against Electron's Node version via `rebuild:native`. `koffi` does **not** need rebuilding.

## Development Workflow

1. Run `npm run dev` — starts Vite dev server on `localhost:5173`, waits for it, then launches Electron.
2. The main process (`src/main/main.ts`) is compiled first via `tsc -p tsconfig.node.json` before Electron starts.
3. For renderer-only iteration, `npm run dev:vite` starts only the Vite server.
4. Use `npm run test:reader` to test the shared memory reader standalone (requires R3E or ACE running).

### Environment Variables

There are no `.env` files. All runtime secrets (API keys, Azure credentials) are stored in the SQLite `app_config` table and exposed to the renderer via the `configGet/configSet` IPC handlers.

## Testing Instructions

There is no automated test suite. Testing is done manually:

- **Shared memory reader**: `npm run test:reader` — validates R3E/ACE SHM reads. All fields must be non-zero when the sim is running. If all zeros or -1, there is a struct offset mismatch (see CLAUDE.md § Struct Offset Debugging).
- **Type checking**: `npm run typecheck` — runs `tsc --noEmit` across all sources.
- **Linting**: `npm run lint` — runs ESLint.

Before merging any change, run `npm run typecheck` and `npm run lint` and fix all errors.

## Code Style

- **TypeScript strict mode** on all files. Use `.ts` for main/shared modules, `.tsx` for React components.
- **`type` over `interface`** for unions and intersections.
- **Named exports everywhere.** No default exports.
- **Relative imports only.** No path aliases.
- **Arrow functions always.** Never use the `function` keyword (not for helpers, callbacks, or module-level utilities).
- **No classes.** Stateful modules export a `createX()` factory returning a plain object. Event-based modules expose `on` bound from an internal `EventEmitter`, not via subclassing.
- **No comments** unless the WHY is non-obvious. Never describe what the code does.
- **ES2024+** syntax: `structuredClone`, `Promise.withResolvers`, `Array.toSorted`, `Object.groupBy`, logical assignment operators, `at()`, etc.
- **UI**: Bootstrap 5 + react-bootstrap. Use react-bootstrap components (`Button`, `Form`, `Modal`) — do not write raw Bootstrap HTML class strings manually.
- **State management**: Zustand only. No Redux, no React Context API for app state.
- **HTTP**: Axios with a shared typed instance. Never call `axios.get/post` directly in components.
- **Icons**: `@fortawesome/react-fontawesome`, import icons individually from their specific package.
- **Dark theme only**: Use CSS custom properties (`--bg`, `--bg2`, `--bg3`, `--border`, `--text`, `--text-dim`, `--accent`). Always add dark-theme CSS overrides in `global.css` for any new Bootstrap components.

See [CODE_STYLE.md](CODE_STYLE.md) for the full style reference.

## Architecture

```
Active game (R3E | ACE) → Reader (EventEmitter, 16ms poll)
  ├─ onFrame → ZoneTracker → RuleEngine (P1/P2 immediate) → AlertDispatcher → TTSManager
  └─ onLapComplete → LapRecorder → AdaptiveBaseline → RuleEngine (P3 post-corner)
                          └─ TrackMapBuilder → track_maps table
                          └─ SQLite (laps_*, zones_json, frames_blob)

[User: "Esegui analisi"] → SessionCoachEngine → Claude API → Template v3
                                                   └─ session_analyses_* table → PdfGenerator

[Keyboard shortcut held] → MediaRecorder → Azure STT → VoiceCoach → Claude streaming → Azure TTS
```

### Source Layout

| Path | Description |
|------|-------------|
| `src/main/` | Electron main process |
| `src/main/r3e/` | R3E shared memory reader and struct |
| `src/main/ace/` | ACE shared memory reader, struct, and setup reader |
| `src/main/coach/` | Rule engine, session coach, adaptive baseline, prompt builder, track map, voice coach |
| `src/main/tts/` | Azure TTS/STT wrapper |
| `src/main/db/` | SQLite schema and queries (`better-sqlite3`) |
| `src/renderer/` | React renderer (Vite) |
| `src/renderer/components/` | React components |
| `src/renderer/hooks/` | Custom React hooks |
| `src/renderer/store/` | Zustand stores (`ipcStore`, `sessionStore`, `settingsStore`) |
| `src/shared/` | Types and utilities shared between main and renderer |

### Key Files

- `src/main/main.ts` — Electron entry; IPC handlers; reader selection; session/lap lifecycle
- `src/main/preload.cts` — Context bridge (`.cts` required by Electron, CommonJS)
- `src/shared/types.ts` — All shared types including `ElectronAPI` (the IPC surface)
- `src/shared/alert-types.ts` — Alert constants, thresholds, anti-spam rules

## Database Schema

SQLite via `better-sqlite3`. Separate game-suffixed tables for R3E and ACE:

- `sessions_{r3e|ace}`, `session_setups_{r3e|ace}`, `laps_{r3e|ace}`, `session_analyses_{r3e|ace}`
- Shared: `baseline`, `corner_names`, `track_maps_{r3e|ace}`, `app_config`

R3E stores numeric IDs for car/track/layout; ACE stores string identifiers (e.g. `"monza"`, `"ks_porsche_718_gt4"`).

`frames_blob` on laps stores gzip-compressed `CompactFrame[]`. `zones_json` stores serialized `ZoneData[]`.

## IPC Contract

The full IPC surface is defined in `src/shared/types.ts` as `ElectronAPI` and exposed via `window.electronAPI` in the renderer. There are three categories:

- **Push** (main → renderer): `onFrame`, `onLapComplete`, `onStatus`, `onInputTrigger`, voice channels, `session:*` events
- **Handle** (renderer → main, async): `sessionStart/End/Analyze`, `lapGetFrames`, `configGet/configSet`, `aceListSetup*`, `voiceQuery`, `tts*`, etc.
- **One-way** (renderer → main): `windowClose/Minimize/Maximize`

Never add IPC channels without updating both `ElectronAPI` in `src/shared/types.ts` and the handler in `src/main/main.ts`.

## Key Design Constraints (Do Not Change)

- **No test suite**: There are intentionally no unit or integration tests.
- **Windows only**: Both R3E and ACE SHM are Windows-only; mock fallback activates on non-Windows.
- **No classes**: Factory functions and closures only.
- **No path aliases**: All imports use relative paths.
- **No process.env in renderer**: Use `import.meta.env` (Vite). Secrets go in `app_config` table.
- **No jsPDF**: PDF generation uses Electron's `printToPDF` + HTML/CSS.
- **No Redux / Context**: Zustand only.
- **16ms polling**: `setTimeout` (not `setInterval`) for SHM readers.
- **Coach model**: `claude-haiku-4-5-20251001` for session analysis; `claude-sonnet-4-6` for voice queries. Model overridable via `anthropicModel` config.
- **Session lifecycle**: Explicit start/end by the user. Analysis is on-demand, not automatic.
- **Multi-game abstraction**: R3E and ACE both normalize to `GameFrame` before reaching the coach pipeline.

## Build and Deployment

```bash
# Type-check + lint before building
npm run typecheck
npm run lint

# Production build (outputs to dist/)
npm run build

# Package installer (electron-builder, outputs to release/)
npm run build:electron
```

`electron-builder` config is in `package.json` (or `electron-builder.yml` if present). The main entry is `dist/main/main.js`.

## Pull Request Guidelines

- Run `npm run typecheck` and `npm run lint` — zero errors required.
- Commits should be atomic and scoped to a single concern.
- Commit message format: `<type>: <short description>` (e.g. `feat: add lap invalidation badge`, `fix: correct ACE SHM offset`).
- Never alter the IPC surface (`ElectronAPI`) without updating both sides (main + preload + renderer types).
- Dark theme: any new Bootstrap component must have a corresponding dark-theme override in `global.css`.

## Workflow di sviluppo — Skill e Agenti

Quando ricevi un task di sviluppo, seleziona skill e agente in base alla tabella seguente. Nei runner che supportano le skill (Claude Code), invocare la skill tramite il tool `Skill` **prima** di qualsiasi altra azione.

**Legenda:**
- `→` nella colonna Skill = passi sequenziali nell'ordine indicato
- `|` nella colonna Agente = alternative, scegliere quella pertinente al sottocompito
- Gli agenti vengono spawnati dopo le skill, non in parallelo ad esse. Il parallelismo tra agenti si usa solo con `superpowers:dispatching-parallel-agents` per sottocompiti davvero indipendenti.

| Task | Skill (nell'ordine) | Agente (uno, in base al bisogno) |
|------|---------------------|----------------------------------|
| Nuova feature | 1. `superpowers:brainstorming` → 2. `feature-dev:feature-dev` | `feature-dev:code-architect` (nuovo design) \| `feature-dev:code-explorer` (esplorazione codebase) |
| Bug fix | `superpowers:systematic-debugging` | `voltagent-qa-sec:debugger` (crash) \| `voltagent-qa-sec:error-detective` (correlazione errori) |
| Code review | `superpowers:requesting-code-review` | `feature-dev:code-reviewer` |
| Refactoring TypeScript | `typescript-advanced-types` | `voltagent-lang:typescript-pro` |
| Componente React / hook / store Zustand | `react-vite-best-practices` | `voltagent-lang:react-specialist` |
| Electron (IPC, packaging, sicurezza) | `electron-best-practices` | `voltagent-core-dev:electron-pro` |
| SQLite / schema / query | `sqlite-database-expert` | `voltagent-data-ai:database-optimizer` |
| Claude API / Anthropic SDK | `claude-api` | `voltagent-data-ai:ai-engineer` |
| Fine branch / PR | `superpowers:finishing-a-development-branch` | — |
| Sottocompiti indipendenti in parallelo | `superpowers:dispatching-parallel-agents` | due o più agenti `Explore` simultanei |

**Regola multi-dominio**: per task che coprono più aree (es. nuova feature React + IPC Electron), iniziare con `superpowers:brainstorming`, poi applicare le skill di dominio durante l'implementazione.

## Common Gotchas

- **`preload.cts`**: Must be CommonJS (`.cts` extension). Do not change to `.ts` or `.mts`.
- **Native rebuild**: If `better-sqlite3` crashes on startup, run `npm run rebuild:native`.
- **Struct offset mismatch**: If `test:reader` shows all zeros, compare struct layout against the latest `R3E.cs` from SecondMonitor connectors or re-verify ACE SHM page sizes.
- **ACE SHM sizes**: PhysicsEvo 800B, GraphicsEvo 3940B, StaticEvo 256B. If `AC_LIVE` field (PhysicsEvo status) is 0, ACE is not running.
- **R3E version field**: `VersionMajor` at offset 0 must be `3`. If it reads `0`, the SHM is not mapped.
- **Mock mode**: `mockHistoryMode` in settings injects static data with negative session IDs. Useful for UI testing without a live sim.
