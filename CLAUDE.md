# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron + React app serving as a **real-time voice coach** for sim racing. Supports two simulators: **RaceRoom Racing Experience (R3E)** and **Assetto Corsa EVO (ACE)**. Reads shared memory on Windows, analyzes driving technique, and produces Italian voice alerts during laps. After each lap, calls Claude API for a full debriefing in Template v3 format.

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
                                           CoachEngine → Claude API → Template v3
                                                |                         |
                                            SQLite DB           PdfGenerator + Debriefing.tsx

Gamepad button held
    → MediaRecorder (getUserMedia)
    → IPC: stt:transcribe (Azure STT)
    → IPC: coach:voiceQuery
    → VoiceCoach streams Claude response
    → IPC: coach:voiceChunk / coach:voiceDone / coach:voiceAudio (MP3)
    → VoiceCoachOverlay + Azure TTS playback
```

### Main process (`src/main/`)
- **main.ts** — Electron entry point; wires ~50 IPC handlers, selects R3E/ACE reader based on `activeGame` config, manages session/lap lifecycle in SQLite
- **preload.ts** — Context bridge exposing `window.electronAPI` to renderer (40+ channels)
- **game-adapter.ts** — Projects R3EFrame → GameFrame (unified 5-field struct: lapDistance, tcActive, absActive, brakeTemps). ACE reader emits GameFrame natively

#### `r3e/`
- **r3e-struct.ts** — R3E shared memory struct layout (v14.0+, 1324 bytes), Pack=4 alignment, auto-computed offsets, read helpers
- **r3e-reader.ts** — Opens `$R3E` via `koffi` + kernel32.dll, polls at 16ms, emits `frame`, `lapComplete`, `connected/disconnected`. Auto-enters mock mode on non-Windows
- **r3e-data-loader.ts** — Loads `r3e-data.json` from the R3E Steam install; resolves numeric IDs → display names for car, track, and layout. Used in prompts and UI; DB always stores numeric IDs for R3E
- **lap-recorder.ts** — Attaches to reader, aggregates frames into 50m zones with driving metrics, handles 2-lap calibration phase
- **zone-tracker.ts** — Stateful tracker for current 50m zone during a lap (feeds RuleEngine real-time checks)

#### `ace/`
- **ace-reader.ts** — Opens three ACE SHM pages (PhysicsEvo 800B, GraphicsEvo 3940B, StaticEvo 256B) via koffi at 16ms. Emits GameFrame + CompactFrame. Car/track/layout are readable strings from SHM (e.g. `"ks_porsche_718_gt4"`, `"monza"`). Lap completion detected via `totalLapCount` increment. Mock fallback on non-Windows
- **ace-struct.ts** — Struct definitions for all three ACE SHM pages with read helpers
- **ace-setup-reader.ts** — Decodes binary protobuf `.carsetup` files from `D:\Salvataggi\ACE\Car Setups\{car}\{track}\`. Extracts setup params (steering ratio, brake bias, ARBs, dampers, geometry, electronics, aero, fuel, compound). Returns `SetupData` with Italian-labelled params

#### `coach/`
- **adaptive-baseline.ts** — EMA (alpha=0.3) baseline per zone, detects deviations (LATE_BRAKE, SLOW_THROTTLE, TRAIL_BRAKING, COASTING, BRAKE_THROTTLE_OVERLAP), persists to SQLite. Game-aware (R3E/ACE) — queries correct table via `game` column in `baseline`
- **rule-engine.ts** — AlertDispatcher (priority queue, P1>P2>P3, dedup per zone/type/lap, 4s silence window) + RuleEngine (frame-level P1/P2, post-lap P3)
- **coach-engine.ts** — Calls Claude API (`claude-haiku-4-5-20251001`) per lap, saves analysis to SQLite, triggers PDF export
- **prompt-builder.ts** — Builds Claude prompt from LapRecord + deviations + resolved names for Template v3 output
- **voice-coach.ts** — Handles free-form voice queries; builds session context from SQLite (laps, zones, deviations, corner names), streams Claude response in Italian (max 3–4 sentences, radio tone)

#### `tts/`
- **azure-tts.ts** — Azure Cognitive Services TTS REST wrapper (axios). Endpoints: voices list + synthesis + STT transcription. Includes Italian number-to-words preprocessing. Falls back gracefully if Azure is not configured

#### `db/`
- **db.ts** — `better-sqlite3` wrapper. Schema has separate tables for each game (see Database Schema below)

#### `pdf-generator.ts`
- Generates lap analysis PDFs via Electron's `printToPDF` + HTML/CSS rendering. Accepts structured `PdfData` (lap metadata, Template v3 markdown, setup params)

### Renderer (`src/renderer/`)

#### `components/`
- **TTSManager.tsx** — Headless component, Web Speech API (it-IT), priority queue, P1 interrupts. Used for real-time lap alerts when Azure TTS is not enabled
- **Debriefing.tsx** — Live telemetry display during session (speed, inputs, brake temps, zone info, alerts). Shows last lap record
- **StatusBar.tsx** — Connection status, car/track/layout (resolved names), calibration state, last alert
- **SessionHistory.tsx** — Paginated list of all past laps (R3E + ACE, filterable by car/track). Detail panel with Template v3 analysis, setup table; "Aggiungi Setup" opens game-appropriate picker (ScreenshotPicker for R3E, AceSetupPicker for ACE); "Esporta PDF" calls main-process PDF generator; supports single-lap and bulk delete
- **SettingsPanel.tsx** — All user settings: API key, assistant name, active game selector (R3E/ACE toggle), Azure TTS/STT config, voice selection, gamepad button capture, mock mode toggle
- **VoiceCoachOverlay.tsx** — Fixed overlay showing voice interaction state: idle (hidden), listening (pulsing mic), processing (spinner + transcript), speaking (streaming answer)
- **ScreenshotPicker.tsx** — R3E only. Modal to select Steam screenshots for setup decoding via Claude Vision; thumbnails, multi-select, triggers IPC `setup:decodeSetup`
- **AceSetupPicker.tsx** — ACE only. Modal to select `.carsetup` files from `D:\Salvataggi\ACE\Car Setups\{car}\{track}\`; triggers IPC `ace:listSetupFiles` / `ace:readSetup` (protobuf decode, no Claude Vision)

#### `hooks/`
- **useIPC.ts** — Hook wrapping `window.electronAPI` for frame/alert/lapComplete/status/analysis. Also exposes `useConfig()` (config:get/set)
- **useVoiceCoach.ts** — Integrates gamepad button, MediaRecorder (audio capture), Azure STT via IPC, voice query streaming, and Azure/Web Speech TTS playback. State machine: idle → listening → processing → speaking
- **useGamepad.ts** — Detects gamepad button press/release via `navigator.getGamepads()`

#### `store/`
- **ipcStore.ts** — Zustand store for IPC push state (frame, lastAlert, lastLap, status, lastAnalysis)
- **settingsStore.ts** — Zustand store for all user settings: `apiKey`, `assistantName`, `gamepadButton`, `activeGame` ("r3e" | "ace"), `ttsEnabled`, `azureTtsEnabled`, `azureSpeechKey`, `azureRegion`, `azureVoiceName`, `mockHistoryMode`

#### `mocks/`
- **mockLap.ts** — Static mock lap data (lapId = -1) used in `mockHistoryMode` to test SessionHistory and PDF export without a live session

### Shared (`src/shared/`)
- **types.ts** — All shared types: `GameSource` ("r3e" | "ace"), `Alert`, `AlertType`, `GameFrame`, `CompactFrame`, `ZoneData`, `LapRecord`, `GameStatus`, `LapRow`, `LapAnalysis`, `R3EFrame`, `AzureVoice`, `SetupData`, `SetupParam`, `Deviation`, `ElectronAPI`
- **format.ts** — `formatLapTime(seconds)` utility (M:SS.mmm)
- **alert-types.ts** — Alert type constants, BRAKE_TEMP thresholds, ANTI_SPAM constants, CALIBRATION_LAPS, POLL_INTERVAL_MS, BASELINE_EMA_ALPHA, DEVIATION_THRESHOLDS
- **corner-names.json** — Track corner names with distance ranges (seed data for known circuits)

## Database Schema

```sql
-- R3E tables
sessions_r3e (id PK, car, track, layout, session_type, started_at, best_lap, lap_count)
laps_r3e     (id PK, session_id FK, lap_number, lap_time, sector1/2/3, valid,
              analysis_json, pdf_path, recorded_at)

-- ACE tables
sessions_ace (id PK, car, track, layout, session_type, started_at, best_lap, lap_count)
laps_ace     (id PK, session_id FK, lap_number, lap_time, sector1/2/3, valid,
              analysis_json, pdf_path, setup_json, setup_screenshots, recorded_at)

-- Shared tables
baseline       (game, car, track, zone_id, data JSON, updated_at)  -- PK: game+car+track+zone_id
baseline_tc_zones  (game, car, track, zone_id)
baseline_abs_zones (game, car, track, zone_id)
corner_names   (track, layout, dist_min PK, dist_max, name)
app_config     (key PK, value)
```

R3E stores numeric IDs; ACE stores string identifiers (e.g. `"monza"`, `"ks_porsche_718_gt4"`).

## IPC Channels (main.ts)

| Direction | Channel | Notes |
|---|---|---|
| Push | `r3e:frame` / `r3e:alert` / `r3e:lapComplete` / `r3e:status` / `r3e:analysis` | Main → Renderer |
| Push | `coach:voiceChunk` / `coach:voiceDone` / `coach:voiceAudio` | Main → Renderer |
| Handle | `config:get` / `config:set` | app_config table |
| Handle | `db:getLaps` / `db:getAllLaps` / `db:getSession` | read |
| Handle | `db:deleteLap` `{ id, game }` | delete single lap |
| Handle | `db:deleteAllLaps` `[{ id, game }]` | bulk delete (transaction) |
| Handle | `tts:getVoices` / `tts:synthesize` / `tts:test` | Azure TTS |
| Handle | `stt:transcribe` | Azure STT |
| Handle | `coach:voiceQuery` | streaming voice response |
| Handle | `setup:listScreenshots` / `setup:decodeSetup` | R3E screenshot setup |
| Handle | `setup:saveSetup` / `setup:exportPdf` / `setup:exportPdfFromData` | R3E setup save/export |
| Handle | `ace:listSetupFiles` / `ace:readSetup` | ACE file-based setup |
| One-way | `window:close` / `window:minimize` / `window:maximize` | frameless window |

## Key Design Decisions (Do Not Change)

- **Multi-game**: Active game selected at startup via `activeGame` config. R3E and ACE share the same coach/analysis pipeline via `GameFrame` abstraction
- **Data source R3E**: Shared Memory (`$R3E`) via `koffi` — not telemetry files. Numeric car/track/layout IDs resolved via R3EDataLoader
- **Data source ACE**: Three SHM pages (PhysicsEvo, GraphicsEvo, StaticEvo) via `koffi`. Car/track/layout are readable strings from SHM
- **Setup loading R3E**: Steam screenshot thumbnails → Claude Vision API decode → `SetupData`
- **Setup loading ACE**: `.carsetup` binary files read directly from `D:\Salvataggi\ACE\Car Setups\{car}\{track}\` → protobuf decode (no Claude Vision)
- **Polling**: 16ms (`setTimeout`, not `setInterval`), reconnect every 2s if sim not running
- **Alerts during lap**: Audio only, alert-driven (no continuous delta). Only fire when there's a problem
- **Alert priorities**: P1 (safety, immediate, interrupts), P2 (TC/ABS anomaly, immediate, queued), P3 (technique, post-corner, max 1 per zone per lap)
- **Anti-spam**: Max 1 alert per (zone × type) per lap, 4s silence window, no P3 within 3s of zone entry
- **Adaptive thresholds**: Auto-calibrate over first 2 laps (skip if baseline exists in DB)
- **Post-lap output**: Template v3 format with 5 sections. Section [5] is read aloud via TTS (max 5 sentences)
- **Coach model**: `claude-haiku-4-5-20251001` for lap analysis. `claude-sonnet-4-6` for voice queries
- **Zones**: 50m segments along track distance
- **Brake temp window**: ideal 550°C ±137.5°C (413–688°C). Skip if value is -1 (unavailable)
- **Qualification/Leaderboard**: Tire temps fixed at 85°C — do not flag as issue
- **Delete**: Single (`db:deleteLap`) and bulk (`db:deleteAllLaps`) lap deletion with game flag routing
- **Window**: 1200×800, no frame, contextIsolation: true, nodeIntegration: false
- **Platform**: Windows only (both R3E and ACE are Windows-only)
- **TTS**: Azure Cognitive Services is the primary TTS/STT provider. Web Speech API is the fallback for real-time lap alerts only
- **State management**: Zustand stores (`ipcStore`, `settingsStore`) — do not scatter state back into `App.tsx`
- **PDF**: `printToPDF` + HTML/CSS template (Electron main process). Do not reintroduce jsPDF
- **Voice queries**: Gamepad button hold → Azure STT → Claude streaming → Azure TTS. Max 3–4 sentences, radio tone, Italian, no bullet points

## Struct Offset Debugging

If `npm run test:reader` shows all zeros or -1: struct offset mismatch. Check:
1. `VersionMajor` at offset 0 must be `3` (updated to v3.x for R3E)
2. If version OK but other fields wrong: `PlayerData` inline size differs from installed R3E version. Compare with `R3E.cs` from SecondMonitor connectors
3. For ACE: verify `AC_LIVE = 2` in PhysicsEvo status field; if 0, ACE is not running

## Code Style

See [CODE_STYLE.md](CODE_STYLE.md).
