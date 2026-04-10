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

Post-install native rebuild is required because `ffi-napi`, `ref-napi`, and `better-sqlite3` need compilation against Electron's Node version.

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
          |          |                         TTSManager (Web Speech API)
          |
          +-- onLapComplete -> LapRecorder -> AdaptiveBaseline -> RuleEngine (P3 post-corner)
                                                |
                                           CoachEngine -> Claude API -> Template v3
                                                |                         |
                                            SQLite DB              TTSManager + PDF
                                                                    Debriefing.jsx
```

### Main process (`src/main/`)
- **r3e/r3e-struct.ts** — R3E shared memory struct layout (v2.16), auto-computed offsets, read helpers
- **r3e/r3e-reader.ts** — Opens `$R3E` via `koffi` + kernel32.dll, polls at 16ms, emits `frame`, `lapComplete`, `connected/disconnected`. Auto-enters mock mode on non-Windows
- **r3e/lap-recorder.ts** — Attaches to reader, aggregates frames into 50m zones with driving metrics, handles 2-lap calibration phase
- **r3e/zone-tracker.ts** — Stateful tracker for current 50m zone during a lap (feeds RuleEngine real-time checks)
- **coach/adaptive-baseline.ts** — EMA (alpha=0.3) baseline per zone, detects deviations (LATE_BRAKE, SLOW_THROTTLE, TRAIL_BRAKING, COASTING, BRAKE_THROTTLE_OVERLAP), persists to SQLite
- **coach/rule-engine.ts** — AlertDispatcher (priority queue, P1>P2>P3, dedup per zone/type/lap, 4s silence window) + RuleEngine (frame-level P1/P2, post-lap P3)
- **coach/coach-engine.ts** — Calls Claude API (claude-sonnet-4-6) per lap, saves analysis to SQLite, triggers PDF export
- **coach/prompt-builder.ts** — Builds Claude prompt from LapRecord + deviations for Template v3 output
- **db/db.ts** — `better-sqlite3` wrapper with schema: baseline, corner_names, sessions, laps

### Renderer (`src/renderer/`)
- **TTSManager.tsx** — Headless component, Web Speech API (it-IT), priority queue, P1 interrupts
- **Debriefing.tsx** — Post-lap panel with Template v3 markdown rendered, PDF export
- **StatusBar.tsx** — Connection status, car/track, calibration state, last alert
- **hooks/useIPC.ts** — Hook wrapping `window.electronAPI` for frame/alert/lapComplete/status

### Shared (`src/shared/`)
- **corner-names.json** — Track corner names with distance ranges (seed data for known circuits)

## Key Design Decisions (Do Not Change)

- **Data source**: R3E Shared Memory (`$R3E`) via `ffi-napi` — not telemetry files
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

## Struct Offset Debugging

If `npm run test:reader` shows all zeros or -1: struct offset mismatch. Check:
1. `VersionMajor` at offset 0 must be `2`
2. If version OK but other fields wrong: `PlayerData` inline size differs from installed R3E version. Compare with `R3E.cs` from SecondMonitor connectors.

## Implementation Order

Build remaining modules in this order: `zone-tracker.ts` -> `main.ts` -> `coach-engine.ts` + `prompt-builder.ts` -> renderer layer. Full specs for each module are in `R3E_COACH_BRIEFING.md`.

## Code Style

See [CODE_STYLE.md](CODE_STYLE.md).
