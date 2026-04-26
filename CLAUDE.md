# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron + React app serving as a **real-time voice coach** for sim racing. Supports two simulators: **RaceRoom Racing Experience (R3E)** and **Assetto Corsa EVO (ACE)**. Reads shared memory on Windows, analyzes driving technique, and produces Italian voice alerts during laps. On demand (per session), calls Claude API for a full debriefing in Template v3 format.

**Language**: All voice output and UI text in Italian. Engineer tone, always include numeric data.
**Code language**: TypeScript strict mode for all source code. Use `.ts` for main/shared modules and `.tsx` for React components.

## Commands

```bash
# Install & rebuild native modules for Electron
npm install
npm run rebuild:native

# Development (Vite + Electron concurrently)
npm run dev

# Test shared memory reader standalone (requires R3E running)
npm run test:reader

# Production build
npm run build
```

Post-install native rebuild is required because `better-sqlite3` needs compilation against Electron's Node version. `koffi` (shared memory FFI) does **not** need rebuilding.

## Architecture

```
Active game selected via Settings (R3E | ACE)
              |
              v
   R3EReader or AceReader (EventEmitter)
     — poll 16ms, emit: connected/disconnected/frame/lapComplete
          |          |
          |          +-- onFrame → ZoneTracker → RuleEngine (P1/P2 immediate)
          |          |                              |
          |          |                         AlertDispatcher
          |          |                              |
          |          |                    TTSManager (Azure TTS / Web Speech)
          |
          +-- onLapComplete → LapRecorder → AdaptiveBaseline → RuleEngine (P3 post-corner)
                                                |
                                           SQLite DB (laps_*, zones_json)
                                                |
                             [User clicks "Esegui analisi"]
                                                |
                                      SessionCoachEngine → Claude API → Template v3
                                                |                         |
                                         session_analyses_*         PdfGenerator
                                         (versioned, multiple)

Gamepad button held
    → MediaRecorder (getUserMedia)
    → IPC: sttTranscribe (Azure STT)
    → IPC: voiceQuery
    → VoiceCoach streams Claude response
    → IPC: onVoiceChunk / onVoiceDone / onVoiceAudio (MP3)
    → VoiceCoachOverlay + Azure TTS playback
```

### Main process (`src/main/`)

- **main.ts** — Electron entry point; wires IPC handlers, selects R3E/ACE reader based on `activeGame` config, manages session/lap lifecycle in SQLite
- **preload.cts** — Context bridge exposing `window.electronAPI` to renderer (CommonJS module, `.cts` extension required by Electron)
- **game-adapter.ts** — Projects R3EFrame → GameFrame (unified 7-field struct: lapDistance, tcActive, absActive, brakeTemps FL/FR/RL/RR). ACE reader emits GameFrame natively

#### `r3e/`

- **r3e-struct.ts** — R3E shared memory struct layout (v14.0+, 1324 bytes), Pack=4 alignment, auto-computed offsets, read helpers
- **r3e-reader.ts** — Opens `$R3E` via `koffi` + kernel32.dll, polls at 16ms, emits `frame`, `lapComplete`, `connected/disconnected`. Auto-enters mock mode on non-Windows
- **r3e-data-loader.ts** — Loads `r3e-data.json` from the R3E Steam install; resolves numeric IDs → display names for car, track, and layout. Used in prompts and UI; DB always stores numeric IDs for R3E
- **lap-recorder.ts** — Attaches to reader, aggregates frames into 50m zones with driving metrics, handles 2-lap calibration phase
- **zone-tracker.ts** — Stateful tracker for current 50m zone during a lap (feeds RuleEngine real-time checks)

#### `ace/`

- **ace-reader.ts** — Opens three ACE SHM pages (PhysicsEvo 800B, GraphicsEvo 3940B, StaticEvo 256B) via koffi at 16ms. Emits GameFrame + CompactFrame (with ACE-only fields: rpm, gLat, gLon, tyre pressures, slip ratios, suspension travel). Car/track/layout are readable strings from SHM (e.g. `"ks_porsche_718_gt4"`, `"monza"`). Lap completion detected via `totalLapCount` increment. Mock fallback on non-Windows
- **ace-struct.ts** — Struct definitions for all three ACE SHM pages with read helpers
- **ace-setup-reader.ts** — Decodes binary protobuf `.carsetup` files from `D:\Salvataggi\ACE\Car Setups\{car}\{track}\`. Extracts setup params (steering ratio, brake bias, ARBs, dampers, geometry, electronics, aero, fuel, compound). Returns `SetupData` with Italian-labelled params

#### `coach/`

- **adaptive-baseline.ts** — EMA (alpha=0.3) baseline per zone, detects deviations (LATE_BRAKE, SLOW_THROTTLE, TRAIL_BRAKING, COASTING, BRAKE_THROTTLE_OVERLAP), persists to SQLite. Game-aware (R3E/ACE) — queries correct table via `game` column in `baseline`
- **rule-engine.ts** — AlertDispatcher (priority queue, P1>P2>P3, dedup per zone/type/lap, 4s silence window) + RuleEngine (frame-level P1/P2, post-lap P3)
- **session-coach.ts** — On-demand session analysis engine (`createSessionCoachEngine`). Loads all laps + setups + prior analyses for a session, builds session-level prompt, streams Claude response, persists versioned `SessionAnalysisRow` to `session_analyses_*`. Multiple analyses per session supported (incremental version counter). Extracts section [5] (max 3 sentences) for TTS.
- **prompt-builder.ts** — Builds Claude prompt from session data + laps + setups + deviations + corner names for Template v3 output. Exports `buildSessionPrompt` and `SESSION_SYSTEM_PROMPT`
- **voice-coach.ts** — Handles free-form voice queries; builds session context from SQLite (laps, zones, deviations, corner names), streams Claude response in Italian (max 3-4 sentences, radio tone)

#### `tts/`

- **azure-tts.ts** — Azure Cognitive Services TTS REST wrapper (axios). Endpoints: voices list + synthesis + STT transcription. Includes Italian number-to-words preprocessing. Falls back gracefully if Azure is not configured

#### `db/`

- **db.ts** — `better-sqlite3` wrapper. Schema has separate tables for each game (see Database Schema below). Also exposes `seedCornersFromLap()` which auto-generates "Curva N" corner names from braking zones on first lap if no corner data exists for the track

#### `pdf-generator.ts`

- Generates session analysis PDFs via Electron's `printToPDF` + HTML/CSS rendering. Accepts session + analyses + setups data

### Renderer (`src/renderer/`)

#### `components/`

- **RealtimeAnalysis.tsx** — Live session panel (tab "Analisi in tempo reale"). Manages session lifecycle (start/end), setup loading, on-demand analysis trigger. Composed of `AnalysisHeader` + `LapsTable` + `AnalysisList`
- **SessionDetail.tsx** — Historical session detail panel. Shown when a row is clicked in `SessionHistory`. Same composition as RealtimeAnalysis but read-only for session lifecycle (analyze + PDF export still enabled). Has a "Indietro" button
- **AnalysisHeader.tsx** — Session header bar with car/track/status badge and action buttons: [Nuova sessione] [Chiudi sessione] [Carica setup] [Esegui analisi] [Esporta PDF] [Indietro]. Reads from `sessionStore`
- **AnalysisList.tsx** — Accordion of all `SessionAnalysisRow` versions for the current session. Shows a streaming placeholder (with Spinner) while an analysis is in progress. Renders Template v3 markdown via `marked`
- **LapsTable.tsx** — Bootstrap dark Table listing laps for the current session (lap#, time, sectors, valid flag, setup badge, timestamp). Reads from `sessionStore`. Setup badge shows "#N" index linked to session setups
- **SessionHistory.tsx** — Paginated list of all past sessions (R3E + ACE). Columns: Sim, Auto (with class), Circuito, Giri, Best lap, Data, Stato. Filters: game/car/track. Sort: date asc/desc. Bulk delete with confirmation modal. Row click → `SessionDetail` inline (back button returns to list). Loads all sessions client-side (up to 500), then filters/paginates in-memory
- **TTSManager.tsx** — Headless component, Web Speech API (it-IT), priority queue, P1 interrupts. Used for real-time lap alerts when Azure TTS is not enabled
- **StatusBar.tsx** — Connection status, car/track/layout (resolved names), calibration state, last alert
- **SettingsPanel.tsx** — All user settings: API key, Anthropic model selector, assistant name, active game selector (R3E/ACE toggle), Azure TTS/STT config, voice selection, gamepad button capture, mock mode toggle
- **VoiceCoachOverlay.tsx** — Fixed overlay showing voice interaction state: idle (hidden), listening (pulsing mic), processing (spinner + transcript), speaking (streaming answer)
- **ScreenshotPicker.tsx** — R3E only. Modal to select Steam screenshots for setup decoding via Claude Vision; thumbnails, multi-select, calls `decodeSetup` IPC
- **AceSetupPicker.tsx** — ACE only. Modal to browse `D:\Salvataggi\ACE\Car Setups\` via 3-step flow: car dropdown → track dropdown → .carsetup file list. IPC calls: `aceListSetupCars`, `aceListSetupTracks`, `aceListSetupFiles`, `aceReadSetup`. Shows a validation badge when the selected car/track doesn't match `expectedCar`/`expectedTrack`

#### `hooks/`

- **useIPC.ts** — Subscribes to push channels (`onFrame`, `onLapComplete`, `onStatus`, voice channels) and writes to `ipcStore`. Also exposes `useConfig()` (configGet/configSet)
- **useVoiceCoach.ts** — Integrates gamepad button, MediaRecorder (audio capture), Azure STT via IPC, voice query streaming, and Azure/Web Speech TTS playback. State machine: idle → listening → processing → speaking
- **useGamepad.ts** — Detects gamepad button press/release via `navigator.getGamepads()`

#### `store/`

- **ipcStore.ts** — Zustand store for real-time IPC push state (frame, lastAlert, lastLap, status)
- **sessionStore.ts** — Zustand store for the active or selected session. Subscribes to `session:*` push channels via `subscribeSessionIPC()` (called once from `App.tsx`). State: `{ mode, session, laps, setups, analyses, streaming, loading, error }`. Methods: `loadCurrent()`, `loadById(id, game)`, `setDetail()`, `reset()`. Internal `_apply*` handlers for each push event
- **settingsStore.ts** — Zustand store for all user settings: `apiKey`, `anthropicModel`, `assistantName`, `gamepadButton`, `activeGame` ("r3e" | "ace"), `ttsEnabled`, `azureTtsEnabled`, `azureSpeechKey`, `azureRegion`, `azureVoiceName`, `mockHistoryMode`

#### `mocks/`

- **mockData.ts** — Static mock data for `mockHistoryMode`. Exports `MOCK_SESSIONS` (two `SessionRow` entries: R3E BMW M4 GT3 at Nürburgring, ACE Porsche 718 GT4 at Monza) and `MOCK_DETAILS` (keyed by negative session id, each with laps + analyses)

### Shared (`src/shared/`)

- **types.ts** — All shared types: `GameSource`, `Alert`, `AlertType`, `AlertPriority`, `Deviation`, `DeviationType`, `GameFrame`, `CompactFrame` (with ACE-only optional fields), `ZoneData` (with ACE-only optional fields), `LapRecord`, `GameStatus`, `SessionRow` (with `ended_at`, `car_class_name`, resolved name fields), `LapRow` (with `setup_id`, `zones_json`), `SessionSetupRow`, `SessionAnalysisRow`, `SessionDetail`, `SessionStartResult`, `SessionListParams`, `SessionListResult`, `SetupData`, `SetupParam`, `R3EFrame`, `CornerEntry`, `CornerNamesMap`, `AzureVoice`, `ElectronAPI`
- **format.ts** — `formatLapTime(seconds)` utility (M:SS.mmm)
- **alert-types.ts** — Alert type constants, BRAKE_TEMP thresholds, ANTI_SPAM constants, CALIBRATION_LAPS, POLL_INTERVAL_MS, BASELINE_EMA_ALPHA, DEVIATION_THRESHOLDS
- **corner-names.json** — Track corner names with distance ranges (seed data for known circuits)

## Database Schema

```sql
-- R3E tables
sessions_r3e         (id PK, car, track, layout, session_type, started_at, ended_at, best_lap, lap_count)
session_setups_r3e   (id PK, session_id FK→sessions_r3e, loaded_at, setup_json, setup_screenshots)
laps_r3e             (id PK, session_id FK→sessions_r3e, setup_id FK→session_setups_r3e,
                      lap_number, lap_time, sector1/2/3, valid, zones_json, recorded_at)
session_analyses_r3e (id PK, session_id FK→sessions_r3e, version, template_v3, section5_summary,
                      created_at) -- UNIQUE(session_id, version)

-- ACE tables (same structure)
sessions_ace         (id PK, car, track, layout, session_type, started_at, ended_at, best_lap, lap_count)
session_setups_ace   (id PK, session_id FK→sessions_ace, loaded_at, setup_json, setup_screenshots)
laps_ace             (id PK, session_id FK→sessions_ace, setup_id FK→session_setups_ace,
                      lap_number, lap_time, sector1/2/3, valid, zones_json, recorded_at)
session_analyses_ace (id PK, session_id FK→sessions_ace, version, template_v3, section5_summary,
                      created_at) -- UNIQUE(session_id, version)

-- Shared tables
baseline             (game, car, track, zone_id, data JSON, updated_at)  -- PK: game+car+track+zone_id
baseline_tc_zones    (game, car, track, zone_id)
baseline_abs_zones   (game, car, track, zone_id)
corner_names         (track, layout, dist_min PK, dist_max, name)
app_config           (key PK, value)
```

R3E stores numeric IDs; ACE stores string identifiers (e.g. `"monza"`, `"ks_porsche_718_gt4"`).

`zones_json` on laps stores the serialized `ZoneData[]` for each completed lap (used for baseline and prompt building).

`session_setups_*` is separate from laps — one session can have multiple setups loaded over time. Each lap row has a `setup_id` FK pointing to which setup was active when the lap was recorded.

`session_analyses_*` supports multiple versioned analyses per session (triggered on demand by the user).

## IPC Channels (`ElectronAPI` in `src/shared/types.ts`)

| Direction | Method / Channel                                                           | Notes                                                        |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Push      | `onFrame`                                                                  | Main → Renderer, `R3EFrame`                                  |
| Push      | `onLapComplete`                                                            | Main → Renderer, `LapRecord`                                 |
| Push      | `onStatus`                                                                 | Main → Renderer, `GameStatus`                                |
| Push      | `onVoiceChunk / onVoiceDone / onVoiceAudio`                                | Voice coach streaming                                        |
| Push      | `onSessionStarted`                                                         | `SessionRow`                                                 |
| Push      | `onSessionClosed`                                                          | `{ id, game }`                                               |
| Push      | `onSessionLapAdded`                                                        | `{ sessionId, game, lap: LapRow }`                           |
| Push      | `onSessionSetupLoaded`                                                     | `{ sessionId, game, setup: SessionSetupRow }`                |
| Push      | `onSessionAnalysisChunk`                                                   | `{ sessionId, version, token }` — streaming                  |
| Push      | `onSessionAnalysisDone`                                                    | `{ sessionId, analysis: SessionAnalysisRow }`                |
| Handle    | `configGet / configSet`                                                    | app_config table                                             |
| Handle    | `sessionStart`                                                             | Opens new session → `SessionStartResult`                     |
| Handle    | `sessionEnd`                                                               | Closes active session                                        |
| Handle    | `sessionAnalyze`                                                           | Triggers `SessionCoachEngine` on-demand                      |
| Handle    | `sessionLoadSetup`                                                         | Saves setup to `session_setups_*`, links to active session   |
| Handle    | `sessionList`                                                              | Paginated session list → `SessionListResult`                 |
| Handle    | `sessionGetCurrent`                                                        | Current session + laps + setups + analyses → `SessionDetail` |
| Handle    | `sessionGetDetail`                                                         | Historical session by id+game → `SessionDetail`              |
| Handle    | `sessionExportPdf`                                                         | Generates PDF → file path                                    |
| Handle    | `sessionDelete`                                                            | Delete single session `{ id, game }`                         |
| Handle    | `sessionDeleteAll`                                                         | Bulk delete `[{ id, game }]` (transaction)                   |
| Handle    | `voiceQuery`                                                               | Streaming voice response via `VoiceCoach`                    |
| Handle    | `sttTranscribe`                                                            | Azure STT → transcribed string                               |
| Handle    | `ttsGetVoices / ttsSynthesize / ttsTest`                                   | Azure TTS                                                    |
| Handle    | `listScreenshots / decodeSetup`                                            | R3E screenshot setup (Claude Vision)                         |
| Handle    | `aceListSetupCars / aceListSetupTracks / aceListSetupFiles / aceReadSetup` | ACE file-based setup                                         |
| One-way   | `windowClose / windowMinimize / windowMaximize`                            | Frameless window                                             |

## Key Design Decisions (Do Not Change)

- **Multi-game**: Active game selected at startup via `activeGame` config. R3E and ACE share the same coach/analysis pipeline via `GameFrame` abstraction
- **Data source R3E**: Shared Memory (`$R3E`) via `koffi` — not telemetry files. Numeric car/track/layout IDs resolved via R3EDataLoader
- **Data source ACE**: Three SHM pages (PhysicsEvo, GraphicsEvo, StaticEvo) via `koffi`. Car/track/layout are readable strings from SHM
- **Setup loading R3E**: Steam screenshot thumbnails → Claude Vision API decode → `SetupData`
- **Setup loading ACE**: `.carsetup` binary files browsed via car→track→file dropdown flow in `AceSetupPicker` → protobuf decode (no Claude Vision). Validation badge warns when selected car/track doesn't match the reference
- **Session lifecycle**: Explicit start/end managed by the user. Laps accumulate in the active session. Setup loads are stored as `session_setups_*` rows and linked to subsequent laps via `setup_id`. Analysis is triggered on demand ("Esegui analisi"), not automatically per-lap
- **Analysis model**: Session-level, on-demand, versioned. `SessionCoachEngine` reads all laps + setups + prior analyses for the session and produces a new `SessionAnalysisRow`. Multiple analyses per session supported. Section [5] (max 3 sentences) is extracted for TTS playback
- **Corner names**: Seeded from `corner-names.json` for known tracks. For unknown tracks, `seedCornersFromLap()` auto-generates "Curva N" names from braking zones on the first lap. Corner names are used in prompts and alerts
- **Polling**: 16ms (`setTimeout`, not `setInterval`), reconnect every 2s if sim not running
- **Alerts during lap**: Audio only, alert-driven (no continuous delta). Only fire when there's a problem
- **Alert priorities**: P1 (safety, immediate, interrupts), P2 (TC/ABS anomaly, immediate, queued), P3 (technique, post-corner, max 1 per zone per lap)
- **Anti-spam**: Max 1 alert per (zone × type) per lap, 4s silence window, no P3 within 3s of zone entry
- **Adaptive thresholds**: Auto-calibrate over first 2 laps (skip if baseline exists in DB)
- **Coach model**: `claude-haiku-4-5-20251001` for session analysis. `claude-sonnet-4-6` for voice queries. Model overridable via `anthropicModel` config key
- **Zones**: 50m segments along track distance
- **Brake temp window**: ideal 550°C ±137.5°C (413-688°C). Skip if value is -1 (unavailable)
- **Qualification/Leaderboard**: Tire temps fixed at 85°C — do not flag as issue
- **Delete**: Single (`sessionDelete`) and bulk (`sessionDeleteAll`) session deletion. Cascade deletes laps, setups, and analyses
- **Window**: 1200×800, no frame, contextIsolation: true, nodeIntegration: false
- **Platform**: Windows only (both R3E and ACE are Windows-only)
- **TTS**: Azure Cognitive Services is the primary TTS/STT provider. Web Speech API is the fallback for real-time lap alerts only
- **State management**: Three Zustand stores — `ipcStore` (real-time frames/alerts), `sessionStore` (active/selected session), `settingsStore` (user settings). Do not scatter state back into `App.tsx`
- **PDF**: `printToPDF` + HTML/CSS template (Electron main process). Do not reintroduce jsPDF
- **Voice queries**: Gamepad button hold → Azure STT → Claude streaming → Azure TTS. Max 3-4 sentences, radio tone, Italian, no bullet points
- **Mock mode**: `mockHistoryMode` in settingsStore injects `MOCK_SESSIONS` and `MOCK_DETAILS` from `mockData.ts` into the session list (negative IDs). Used to test SessionHistory and SessionDetail without a live session

## Struct Offset Debugging

If `npm run test:reader` shows all zeros or -1: struct offset mismatch. Check:

1. `VersionMajor` at offset 0 must be `3` (updated to v3.x for R3E)
2. If version OK but other fields wrong: `PlayerData` inline size differs from installed R3E version. Compare with `R3E.cs` from SecondMonitor connectors
3. For ACE: verify `AC_LIVE = 2` in PhysicsEvo status field; if 0, ACE is not running

## Code Style

See [CODE_STYLE.md](CODE_STYLE.md).

## UI Theme

The app uses a **dark theme** exclusively. All UI components must use the CSS custom properties defined in `:root` (`--bg`, `--bg2`, `--bg3`, `--border`, `--text`, `--text-dim`, `--accent`). Never use Bootstrap's default light-background components without overriding them with the dark theme variables. When adding new Bootstrap components (Modal, Accordion, Card, etc.), always add corresponding dark-theme CSS overrides in `global.css`.
