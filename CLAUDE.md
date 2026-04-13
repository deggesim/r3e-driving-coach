# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron + React app serving as a **real-time voice coach** for RaceRoom Racing Experience (R3E). Reads R3E shared memory on Windows, analyzes driving technique, and produces Italian voice alerts during laps. After each lap, calls Claude API for a full debriefing in Template v3 format.

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
R3E Shared Memory ($R3E) — polling 16ms
              |
              v
        R3EReader (EventEmitter)
          |          |
          |          +-- onFrame -> ZoneTracker -> RuleEngine (P1/P2 immediate)
          |          |                              |
          |          |                         AlertDispatcher
          |          |                              |
          |          |                    TTSManager (Azure TTS / Web Speech)
          |
          +-- onLapComplete -> LapRecorder -> AdaptiveBaseline -> RuleEngine (P3 post-corner)
                                                |
                                           CoachEngine -> Claude API -> Template v3
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
- **main.ts** — Electron entry point; wires IPC handlers, R3EReader, LapRecorder, ZoneTracker, RuleEngine, CoachEngine
- **preload.ts** — Context bridge exposing `window.electronAPI` to renderer

#### `r3e/`
- **r3e-struct.ts** — R3E shared memory struct layout (v3.x), auto-computed offsets, read helpers
- **r3e-reader.ts** — Opens `$R3E` via `koffi` + kernel32.dll, polls at 16ms, emits `frame`, `lapComplete`, `connected/disconnected`. Auto-enters mock mode on non-Windows
- **r3e-data-loader.ts** — Loads `r3e-data.json` from the R3E Steam install; resolves numeric IDs → display names for car, track, and layout. Used in prompts and UI; DB always stores numeric IDs
- **lap-recorder.ts** — Attaches to reader, aggregates frames into 50m zones with driving metrics, handles 2-lap calibration phase
- **zone-tracker.ts** — Stateful tracker for current 50m zone during a lap (feeds RuleEngine real-time checks)

#### `coach/`
- **adaptive-baseline.ts** — EMA (alpha=0.3) baseline per zone, detects deviations (LATE_BRAKE, SLOW_THROTTLE, TRAIL_BRAKING, COASTING, BRAKE_THROTTLE_OVERLAP), persists to SQLite
- **rule-engine.ts** — AlertDispatcher (priority queue, P1>P2>P3, dedup per zone/type/lap, 4s silence window) + RuleEngine (frame-level P1/P2, post-lap P3)
- **coach-engine.ts** — Calls Claude API (claude-sonnet-4-6) per lap, saves analysis to SQLite, triggers PDF export
- **prompt-builder.ts** — Builds Claude prompt from LapRecord + deviations + resolved names for Template v3 output
- **voice-coach.ts** — Handles free-form voice queries; builds session context from SQLite (laps, zones, deviations, corner names), streams Claude response in Italian (max 3–4 sentences, radio tone)

#### `tts/`
- **azure-tts.ts** — Azure Cognitive Services TTS REST wrapper (axios). Endpoints: voices list + synthesis. Includes Italian number-to-words preprocessing to improve TTS output quality. Falls back gracefully if Azure is not configured

#### `db/`
- **db.ts** — `better-sqlite3` wrapper with schema: `baseline`, `corner_names`, `sessions`, `laps`, `setups`

#### `pdf-generator.ts`
- Generates lap analysis PDFs via Electron's `printToPDF` + HTML/CSS rendering. Accepts structured `PdfData` (lap metadata, Template v3 markdown, setup params). Replaces the old jsPDF approach

### Renderer (`src/renderer/`)

#### `components/`
- **TTSManager.tsx** — Headless component, Web Speech API (it-IT), priority queue, P1 interrupts. Used for real-time lap alerts when Azure TTS is not enabled
- **Debriefing.tsx** — Post-lap panel rendering Template v3 markdown (via `marked`), PDF export trigger
- **StatusBar.tsx** — Connection status, car/track/layout (resolved names), calibration state, last alert
- **SessionHistory.tsx** — Paginated list of past laps; detail panel with Template v3 analysis, setup table; "Aggiungi Setup" opens ScreenshotPicker; "Esporta PDF" calls main-process PDF generator with native save dialog
- **SettingsPanel.tsx** — All user settings: API key, assistant name, Azure TTS/STT config, voice selection, gamepad button, mock mode toggle
- **VoiceCoachOverlay.tsx** — Fixed overlay showing voice interaction state: idle (hidden), listening (pulsing mic), processing (spinner + transcript), speaking (streaming answer)
- **ScreenshotPicker.tsx** — Modal to select Steam screenshots for setup decoding via Claude Vision; thumbnails, multi-select, triggers IPC call to decode setup params

#### `hooks/`
- **useIPC.ts** — Hook wrapping `window.electronAPI` for frame/alert/lapComplete/status
- **useVoiceCoach.ts** — Integrates gamepad button, MediaRecorder (audio capture), Azure STT via IPC, voice query streaming, and Azure/Web Speech TTS playback. State machine: idle → listening → processing → speaking
- **useGamepad.ts** — Detects gamepad button press/release via `navigator.getGamepads()`

#### `store/`
- **ipcStore.ts** — Zustand store for IPC push state (frame, lastAlert, lastLap, status, lastAnalysis)
- **settingsStore.ts** — Zustand store for all user settings (loaded from SQLite via IPC on startup)

#### `mocks/`
- **mockLap.ts** — Static mock lap data (lapId = -1) used in `mockHistoryMode` to test SessionHistory and PDF export without a live session

### Shared (`src/shared/`)
- **types.ts** — All shared types: `Alert`, `AlertType`, `LapRecord`, `LapRow`, `LapAnalysis`, `R3EStatus`, `AzureVoice`, `SetupData`, `SetupParam`, `Deviation`
- **format.ts** — `formatLapTime(seconds)` utility (M:SS.mmm or SS.mms)
- **alert-types.ts** — Alert type constants
- **corner-names.json** — Track corner names with distance ranges (seed data for known circuits)

## Key Design Decisions (Do Not Change)

- **Data source**: R3E Shared Memory (`$R3E`) via `koffi` — not telemetry files
- **Polling**: 16ms (`setTimeout`, not `setInterval`), reconnect every 2s if R3E not running
- **Alerts during lap**: Audio only, alert-driven (no continuous delta). Only fire when there's a problem
- **Alert priorities**: P1 (safety, immediate, interrupts), P2 (TC/ABS anomaly, immediate, queued), P3 (technique, post-corner, max 1 per zone per lap)
- **Anti-spam**: Max 1 alert per (zone x type) per lap, 4s silence window, no P3 within 3s of zone entry
- **Adaptive thresholds**: Auto-calibrate over first 2 laps (skip if baseline exists in DB)
- **Post-lap output**: Template v3 format with 5 sections. Section [5] is read aloud via TTS (max 5 sentences)
- **Zones**: 50m segments along track distance
- **Brake temp window**: ideal 550C +/-137.5C (413-688C). Skip if value is -1 (unavailable)
- **Qualification/Leaderboard**: Tire temps fixed at 85C — do not flag as issue
- **Window**: 1200x800, no frame, contextIsolation: true, nodeIntegration: false
- **Platform**: Windows only (R3E is Windows-only)
- **TTS**: Azure Cognitive Services is the primary TTS/STT provider (Web Speech API fails in Electron outside Chrome). Web Speech API is the fallback for real-time lap alerts only
- **State management**: Zustand stores (`ipcStore`, `settingsStore`) — do not scatter state back into `App.tsx`
- **Car/track resolution**: Numeric IDs from shared memory are always resolved via `R3EDataLoader` before display or prompt construction; DB stores numeric IDs only
- **Setup decoding**: Via Claude Vision API reading Steam screenshot thumbnails; decoded params stored in `setups` table linked to a lap
- **PDF**: `printToPDF` + HTML/CSS template (Electron main process). Do not reintroduce jsPDF
- **Voice queries**: Gamepad button hold → Azure STT → Claude streaming → Azure TTS. Max 3–4 sentences, radio tone, Italian, no bullet points

## Struct Offset Debugging

If `npm run test:reader` shows all zeros or -1: struct offset mismatch. Check:
1. `VersionMajor` at offset 0 must be `3` (updated to v3.x)
2. If version OK but other fields wrong: `PlayerData` inline size differs from installed R3E version. Compare with `R3E.cs` from SecondMonitor connectors.

## Code Style

See [CODE_STYLE.md](CODE_STYLE.md).
