# R3E Voice Coach — Briefing per Claude Code

## Contesto del progetto

App Electron + React che funge da **voice coach in tempo reale** per RaceRoom Racing Experience (R3E). Legge la shared memory di R3E direttamente (Windows API), analizza la tecnica di guida e produce alert vocali in italiano durante il giro. Dopo il giro, chiama Claude API per un debriefing completo nel Template v3 già usato nelle sessioni di analisi telemetria.

---

## Decisioni di design già prese (non riaprire)

| Parametro              | Scelta                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| Sorgente dati live     | R3E Shared Memory (`$R3E`) via `ffi-napi` + kernel32.dll                  |
| Polling rate           | 16ms (~60fps)                                                             |
| Output durante il giro | **Solo audio** — alert TTS in italiano, alert-driven                      |
| Output post-giro       | Debriefing voce + testo Template v3 + export PDF                          |
| Alert durante il giro  | **Solo quando c'è un problema** (no delta continuo)                       |
| Soglie alert           | **Adattive** — calibrazione automatica nei primi 2 giri                   |
| Timing alert           | Immediato per P1/P2 (safety, TC/ABS anomali), post-curva per P3 (tecnica) |
| TC/ABS                 | Alert se attivo in zona fuori dal profilo storico                         |
| Reference lap          | Best lap storico per auto+circuito (da SQLite)                            |
| Stile messaggi vocali  | Italiano, tono ingegnere, con dato numerico sempre incluso                |
| Identificazione curva  | Nome ufficiale + metro (es. "Bianchibocht, metro 2209")                   |
| UI durante il giro     | Nessuna — solo audio                                                      |
| UI post-giro           | Pannello Debriefing con Template v3 + storico sessioni                    |
| API key Anthropic      | Già disponibile, configurabile da UI                                      |
| Lingua                 | Italiano                                                                  |
| Platform target        | Windows only (R3E è Windows)                                              |
| Build                  | Electron 30 + Vite + React 18                                             |

---

## Architettura

```
R3E Shared Memory ($R3E) — polling 16ms
              │
              ▼
        R3EReader (EventEmitter)
          │          │
          │          ├── onFrame → ZoneTracker → RuleEngine (P1/P2 immediati)
          │          │                              │
          │          │                         AlertDispatcher
          │          │                              │
          │          │                         TTSManager (Web Speech API)
          │          │
          └── onLapComplete → LapRecorder → AdaptiveBaseline → RuleEngine (P3 post-curva)
                                                │
                                           CoachEngine → Claude API → Template v3
                                                │                         │
                                            SQLite DB              TTSManager (sintesi)
                                                                         +
                                                                    PDF export
                                                                    Debriefing.jsx
```

### Priorità alert

| Priorità | Tipo                | Timing                      | Esempio messaggio                                                |
| -------- | ------------------- | --------------------------- | ---------------------------------------------------------------- |
| P1       | Brake temp critica  | Immediato, interrompe tutto | "Freni anteriori a 695 gradi — zona critica"                     |
| P2       | TC/ABS zona anomala | Immediato, coda             | "TC attivo alla Bianchibocht — zona insolita"                    |
| P3       | Tecnica di guida    | Post-curva, max 1/zona/giro | "Bianchibocht, metro 2209: frenato 18 metri dopo il riferimento" |

### Anti-spam

- Max 1 alert per `(zona × tipo)` per giro
- Silence window 4s dopo ogni alert
- Nessun alert P3 entro 3s dall'ingresso nella zona

---

## Struttura progetto

```
r3e-driving-coach/
├── package.json                          ✅ COMPLETO
├── src/
│   ├── main/
│   │   ├── main.js                       ❌ DA FARE
│   │   ├── r3e/
│   │   │   ├── r3e-struct.js             ✅ COMPLETO
│   │   │   ├── r3e-reader.js             ✅ COMPLETO
│   │   │   ├── lap-recorder.js           ✅ COMPLETO
│   │   │   └── zone-tracker.js           ❌ DA FARE (leggero, vedi spec sotto)
│   │   ├── coach/
│   │   │   ├── adaptive-baseline.js      ✅ COMPLETO
│   │   │   ├── rule-engine.js            ✅ COMPLETO
│   │   │   ├── coach-engine.js           ❌ DA FARE
│   │   │   └── prompt-builder.js         ❌ DA FARE
│   │   └── db/
│   │       └── db.js                     ✅ COMPLETO
│   ├── renderer/
│   │   ├── index.html                    ❌ DA FARE
│   │   ├── main.jsx                      ❌ DA FARE
│   │   ├── App.jsx                       ❌ DA FARE
│   │   ├── components/
│   │   │   ├── TTSManager.jsx            ❌ DA FARE
│   │   │   ├── Debriefing.jsx            ❌ DA FARE
│   │   │   ├── SessionHistory.jsx        ❌ DA FARE
│   │   │   └── StatusBar.jsx             ❌ DA FARE
│   │   └── hooks/
│   │       └── useIPC.js                 ❌ DA FARE
│   └── shared/
│       ├── alert-types.js                ❌ DA FARE
│       └── corner-names.json             ❌ DA FARE (seed data)
├── python/
│   └── generate_pdf.py                   ❌ DA FARE (adattare da sessioni esistenti)
└── electron-builder.config.js           ❌ DA FARE
```

---

## File già scritti — contenuto completo

### `package.json`

```json
{
  "name": "r3e-driving-coach",
  "version": "0.1.0",
  "description": "R3E Voice Coach — real-time driving coach for RaceRoom Racing Experience",
  "main": "src/main/main.js",
  "scripts": {
    "start": "electron .",
    "dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
    "build": "vite build && electron-builder",
    "test:reader": "node src/main/r3e/r3e-reader.js"
  },
  "dependencies": {
    "ffi-napi": "^4.0.3",
    "ref-napi": "^3.0.3",
    "better-sqlite3": "^9.4.3",
    "electron-store": "^8.1.0"
  },
  "devDependencies": {
    "electron": "^30.0.0",
    "electron-builder": "^24.13.3",
    "concurrently": "^8.2.2",
    "wait-on": "^7.2.0",
    "vite": "^5.2.0",
    "@vitejs/plugin-react": "^4.2.1",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "build": {
    "appId": "com.r3ecoach.app",
    "productName": "R3E Coach",
    "win": { "target": "nsis" },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

---

### `src/main/r3e/r3e-struct.js`

```javascript
/**
 * R3E Shared Memory Struct Definition
 * Source: sector3studios/r3e-api v2.16 (sample-csharp/src/R3E.cs)
 * Shared memory name: $R3E
 *
 * All fields declared in struct order — offsets computed automatically.
 */

"use strict";

const SIZE = {
  int32: 4,
  uint32: 4,
  float: 4,
  double: 8,
  byte: 1,
};

const STRUCT_FIELDS = [
  // Version
  { name: "VersionMajor", type: "int32" },
  { name: "VersionMinor", type: "int32" },

  // Game State
  { name: "GamePaused", type: "int32" },
  { name: "GameInMenus", type: "int32" },
  { name: "GameInReplay", type: "int32" },
  { name: "GameUsingVr", type: "int32" },
  { name: "GameUnused1", type: "int32" },
  { name: "GameSimulationTime", type: "float" },
  { name: "GameSimulationTicks", type: "float" },

  // PlayerData (inlined)
  { name: "Player_SimTime", type: "double" },
  { name: "Player_SimTicks", type: "double" },
  { name: "Player_Pos_X", type: "double" },
  { name: "Player_Pos_Y", type: "double" },
  { name: "Player_Pos_Z", type: "double" },
  { name: "Player_Vel_X", type: "double" },
  { name: "Player_Vel_Y", type: "double" },
  { name: "Player_Vel_Z", type: "double" },
  { name: "Player_LocalVel_X", type: "double" },
  { name: "Player_LocalVel_Y", type: "double" },
  { name: "Player_LocalVel_Z", type: "double" },
  { name: "Player_Acc_X", type: "double" },
  { name: "Player_Acc_Y", type: "double" },
  { name: "Player_Acc_Z", type: "double" },
  { name: "Player_LocalAcc_X", type: "double" },
  { name: "Player_LocalAcc_Y", type: "double" },
  { name: "Player_LocalAcc_Z", type: "double" },
  { name: "Player_Gforce_X", type: "double" },
  { name: "Player_Gforce_Y", type: "double" },
  { name: "Player_Gforce_Z", type: "double" },
  { name: "Player_Orientation_X", type: "double" },
  { name: "Player_Orientation_Y", type: "double" },
  { name: "Player_Orientation_Z", type: "double" },
  { name: "Player_AngVel_X", type: "double" },
  { name: "Player_AngVel_Y", type: "double" },
  { name: "Player_AngVel_Z", type: "double" },
  { name: "Player_AngAcc_X", type: "double" },
  { name: "Player_AngAcc_Y", type: "double" },
  { name: "Player_AngAcc_Z", type: "double" },

  // Session Info
  { name: "TrackName", type: "byte", count: 64 },
  { name: "LayoutName", type: "byte", count: 64 },
  { name: "TrackId", type: "int32" },
  { name: "LayoutId", type: "int32" },
  { name: "LayoutLength", type: "float" },
  { name: "SectorStartFactors", type: "float", count: 3 },
  { name: "RaceSessionLaps", type: "int32", count: 3 },
  { name: "RaceSessionMinutes", type: "int32", count: 3 },
  { name: "EventIndex", type: "int32" },
  { name: "SessionType", type: "int32" },
  { name: "SessionIteration", type: "int32" },
  { name: "SessionLengthFormat", type: "int32" },
  { name: "SessionPitSpeedLimit", type: "float" },
  { name: "SessionPhase", type: "int32" },
  { name: "SessionLap", type: "int32" },
  { name: "SessionNumLaps", type: "int32" },
  { name: "SessionTimeRemaining", type: "float" },
  { name: "SessionTimeDuration", type: "float" },
  { name: "Position", type: "int32" },
  { name: "PositionClass", type: "int32" },
  { name: "FinishStatus", type: "int32" },
  { name: "CutTrackWarnings", type: "int32" },

  // Pit/Flag state
  { name: "PitWindowStatus", type: "int32" },
  { name: "PitWindowStart", type: "int32" },
  { name: "PitWindowEnd", type: "int32" },
  { name: "InPitlane", type: "int32" },
  { name: "PitMenuSelection", type: "int32" },
  { name: "PitState", type: "int32" },
  { name: "PitTotalDuration", type: "float" },
  { name: "PitElapsedTime", type: "float" },
  { name: "PitAction", type: "int32" },
  { name: "NumPitstopsPerformed", type: "int32" },
  { name: "Flags_Yellow", type: "int32" },
  { name: "Flags_YellowCausedIt", type: "int32" },
  { name: "Flags_YellowOvertake", type: "int32" },
  { name: "Flags_YellowPositions", type: "int32" },
  { name: "Flags_Blue", type: "int32" },
  { name: "Flags_Black", type: "int32" },
  { name: "Flags_BlackWhite", type: "int32" },
  { name: "Flags_Checkered", type: "int32" },
  { name: "Flags_Green", type: "int32" },
  { name: "Flags_PitstopRequest", type: "int32" },

  // Lap data
  { name: "CompletedLaps", type: "int32" },
  { name: "CurrentLapValid", type: "int32" },
  { name: "TrackSector", type: "int32" },
  { name: "LapDistance", type: "float" },
  { name: "LapDistanceFraction", type: "float" },

  // Timing
  { name: "LapTimeBestLeader", type: "float" },
  { name: "LapTimeBestLeaderClass", type: "float" },
  { name: "SectorTimesSessionBestLeader", type: "float", count: 3 },
  { name: "SectorTimesSessionBestLeaderClass", type: "float", count: 3 },
  { name: "LapTimeBestSelf", type: "float" },
  { name: "SectorTimesBestSelf", type: "float", count: 3 },
  { name: "LapTimePreviousSelf", type: "float" },
  { name: "SectorTimesPreviousSelf", type: "float", count: 3 },
  { name: "LapTimeCurrentSelf", type: "float" },
  { name: "SectorTimesCurrentSelf", type: "float", count: 3 },
  { name: "LapTimeDeltaLeader", type: "float" },
  { name: "LapTimeDeltaLeaderClass", type: "float" },
  { name: "TimeDeltaFront", type: "float" },
  { name: "TimeDeltaBehind", type: "float" },
  { name: "TimeDeltaBestSelf", type: "float" },

  // Vehicle
  { name: "VehicleInfo_ModelId", type: "int32" },
  { name: "VehicleInfo_ClassId", type: "int32" },
  { name: "VehicleInfo_Name", type: "byte", count: 64 },
  { name: "VehicleInfo_CarNumber", type: "byte", count: 16 },
  { name: "VehicleInfo_ClassPerformanceIndex", type: "int32" },
  { name: "VehicleInfo_EngineType", type: "int32" },
  { name: "EngineRps", type: "float" },
  { name: "MaxEngineRps", type: "float" },
  { name: "UpshiftRps", type: "float" },
  { name: "CarSpeed", type: "float" },
  { name: "Gear", type: "int32" },
  { name: "NumGears", type: "int32" },
  { name: "CarCgLocation", type: "float", count: 3 },

  // Inputs
  { name: "Throttle", type: "float" },
  { name: "ThrottleRaw", type: "float" },
  { name: "Brake", type: "float" },
  { name: "BrakeRaw", type: "float" },
  { name: "Clutch", type: "float" },
  { name: "ClutchRaw", type: "float" },
  { name: "SteerInputRaw", type: "float" },
  { name: "SteerLockDeg", type: "float" },
  { name: "SteerWheelRangeDeg", type: "float" },

  // Aid settings
  { name: "AidSettings_Abs", type: "int32" },
  { name: "AidSettings_Tc", type: "int32" },
  { name: "AidSettings_Esp", type: "int32" },
  { name: "AidSettings_Countersteer", type: "int32" },
  { name: "AidSettings_CornferingForce", type: "int32" },
  { name: "AidAbsActive", type: "float" },
  { name: "AidTcActive", type: "float" },
  { name: "AidEspActive", type: "float" },

  // Engine/fuel
  { name: "FuelLeft", type: "float" },
  { name: "FuelCapacity", type: "float" },
  { name: "FuelPerLap", type: "float" },
  { name: "EngineTempCelsius", type: "float" },
  { name: "OilTempCelsius", type: "float" },
  { name: "EngineTorque", type: "float" },
  { name: "CurrentGearSpeed", type: "float" },
  { name: "EngineBrake", type: "int32" },
  { name: "EngineBrakeSetting", type: "int32" },

  // Aero
  { name: "TurboPressure", type: "float" },
  { name: "Drs", type: "float" },
  { name: "DrsAvailable", type: "int32" },
  { name: "DrsEnabled", type: "int32" },
  { name: "WheelLoad", type: "float", count: 4 },
  { name: "Downforce", type: "float" },
  { name: "Drag", type: "float" },

  // Tires
  { name: "TireGrip", type: "float", count: 4 },
  { name: "TireWear", type: "float", count: 4 },
  { name: "BrakeTempCurrentEstimate", type: "float", count: 4 },
  { name: "BrakeTempActualEstimate", type: "float", count: 4 },
  { name: "TireLoad", type: "float", count: 4 },
  { name: "TirePressure", type: "float", count: 4 },
  { name: "TireVelocity", type: "float", count: 4 },
  { name: "TireTempLeft", type: "float", count: 4 },
  { name: "TireTempCenter", type: "float", count: 4 },
  { name: "TireTempRight", type: "float", count: 4 },
  { name: "RideHeight", type: "float", count: 4 },
  { name: "SuspensionDeflection", type: "float", count: 4 },
  { name: "SuspensionVelocity", type: "float", count: 4 },
  { name: "Camber", type: "float", count: 4 },
  { name: "RollAngle", type: "float", count: 2 },
  { name: "WheelRps", type: "float", count: 4 },
  { name: "TireTypeFront", type: "int32" },
  { name: "TireTypeRear", type: "int32" },
  { name: "TireSubtypeFront", type: "int32" },
  { name: "TireSubtypeRear", type: "int32" },

  // Damage
  { name: "CarDamage_Engine", type: "float" },
  { name: "CarDamage_Transmission", type: "float" },
  { name: "CarDamage_Aerodynamics", type: "float" },
  { name: "CarDamage_Suspension", type: "float" },

  // Driver
  { name: "DriverName", type: "byte", count: 64 },
  { name: "DriverCarNumber", type: "byte", count: 16 },
  { name: "DriverClassId", type: "int32" },
  { name: "NumCars", type: "int32" },
];

// Auto-compute offsets
const OFFSETS = {};
let _cursor = 0;
for (const field of STRUCT_FIELDS) {
  const byteSize = SIZE[field.type] * (field.count || 1);
  OFFSETS[field.name] = _cursor;
  _cursor += byteSize;
}

const STRUCT_SIZE_KNOWN = _cursor;

function readInt32(buf, name) {
  return buf.readInt32LE(OFFSETS[name]);
}
function readFloat(buf, name) {
  return buf.readFloatLE(OFFSETS[name]);
}
function readDouble(buf, name) {
  return buf.readDoubleLE(OFFSETS[name]);
}
function readFloatArray(buf, name, count) {
  const base = OFFSETS[name];
  return Array.from({ length: count }, (_, i) => buf.readFloatLE(base + i * 4));
}
function readString(buf, name, byteLen) {
  const base = OFFSETS[name];
  const slice = buf.slice(base, base + byteLen);
  const end = slice.indexOf(0);
  return slice.slice(0, end < 0 ? byteLen : end).toString("utf8");
}

module.exports = {
  OFFSETS,
  STRUCT_SIZE_KNOWN,
  STRUCT_FIELDS,
  readInt32,
  readFloat,
  readDouble,
  readFloatArray,
  readString,
  SHM_NAME: "$R3E",
  VERSION_MAJOR: 2,
  VERSION_MINOR_MIN: 16,
};
```

---

### `src/main/r3e/r3e-reader.js`

> File lungo (541 righe). Incolla il contenuto dal repository o chiedi a Claude Code di rigenerarlo dalla specifica sotto.

**Specifica**: EventEmitter che:

- Apre `$R3E` via `kernel32.OpenFileMappingA` + `MapViewOfFile` usando `ffi-napi`
- Buffer size: 1MB
- Poll ogni 16ms con `setTimeout` (non `setInterval`)
- Riconnette ogni 2s se R3E non è in esecuzione
- Emette: `connected`, `disconnected`, `frame(data)`, `lapComplete(lapData)`, `sectorComplete(n, time)`
- `frame` contiene tutti i campi parsati da `r3e-struct.js` normalizzati (m/s→km/h, rad/s→rpm)
- `lapComplete` contiene `{ lapNumber, lapTime, sectorTimes, frames[], car, track, layout, layoutLength, valid }`
- Frames accumulati in formato compatto: `{ d, spd, thr, brk, str, gear, abs, tc, bt[], ts }`
- Mock mode automatico su non-Windows: `new R3EReader({ mock: true })`
- Test standalone con `node r3e-reader.js`

---

### `src/main/r3e/lap-recorder.js`

> File (192 righe). Specifica per rigenerazione:

**Specifica**: EventEmitter che:

- Si attacca a `R3EReader` via `.attach(reader)`
- Emette `lapRecorded(lap, { calibrating })` e `newBestLap(lap)` e `calibrationComplete`
- Calibrazione: primi 2 giri silenziosi
- `LapRecord` contiene: `{ lapNumber, lapTime, sectorTimes, valid, car, track, layout, layoutLength, frames[], zones[], recordedAt }`
- `zones[]` = aggregati per zone da 50m: `{ zone, dist, avgSpeedKmh, minSpeedKmh, maxBrakePct, avgThrottlePct, maxSteerAbs, steerDuringBrake, brakeFrames, throttleFrames, coastFrames, overlapFrames, tcActivations, absActivations, brakeStartDist, brakeEndDist, throttlePickupDist }`
- `throttlePickupDist`: primo frame con `thr > 20%` dopo l'ultimo frame di frenata

---

### `src/main/coach/adaptive-baseline.js`

> File (316 righe). Specifica per rigenerazione:

**Specifica**: Classe `AdaptiveBaseline(car, track, db?)`:

- EMA con α=0.3 per aggiornare metriche per zona
- `ingestLap(zones, lapNumber, isCalibrating)` → `deviations[]` o `null` durante calibrazione
- `checkZoneRealtime(zoneData)` → alert immediati per TC/ABS anomali (usato dal RuleEngine ogni frame)
- Deviazioni rilevate: `LATE_BRAKE` (+15m), `SLOW_THROTTLE` (+12m), `TRAIL_BRAKING` (steer delta +0.08), `COASTING` (+8 frames), `BRAKE_THROTTLE_OVERLAP` (+5 frames)
- Persiste su SQLite: tabelle `baseline`, `baseline_tc_zones`, `baseline_abs_zones`
- Carica automaticamente da DB all'avvio (se esistente, skip calibrazione)

---

### `src/main/coach/rule-engine.js`

**Specifica**: Due classi:

`AlertDispatcher(EventEmitter)`:

- Priority queue ordinata per P1→P3
- De-duplica per `zone×type` per giro
- Silence window 4s tra alert (P1 bypassa)
- Emette `alert({ type, priority, zone, dist, message, immediate, data })`

`RuleEngine(dispatcher, baseline, getCornerName)`:

- `processFrame(frame)` → P1 brake temp + P2 TC/ABS immediati
- `processLapDeviations(deviations)` → P3 post-curva da AdaptiveBaseline
- Messaggi italiani con dato numerico, usa `getCornerName(dist)` per nome ufficiale

---

### `src/main/db/db.js`

**Specifica**: `getDb(userDataPath)` → `better-sqlite3` instance con schema:

```sql
baseline (car, track, zone_id PK, data JSON, updated_at)
baseline_tc_zones (car, track, zone_id PK)
baseline_abs_zones (car, track, zone_id PK)
corner_names (track, layout, dist_min PK, dist_max, name)
sessions (id PK, car, track, layout, session_type, started_at, best_lap, lap_count)
laps (id PK, session_id FK, lap_number, lap_time, sector1/2/3, valid, analysis_json, pdf_path, recorded_at)
```

Helper: `getCornerName(db, track, layout, dist)` → string|null

---

## File da scrivere — specifiche dettagliate

### `src/main/r3e/zone-tracker.js` (leggero)

Traccia la zona corrente (50m) durante il giro e mantiene metriche rolling per la zona attiva. Usato da `RuleEngine.processFrame()` per alimentare `baseline.checkZoneRealtime()`.

```javascript
// ZoneTracker (non EventEmitter, stateful object)
class ZoneTracker {
  update(frame)         // chiama su ogni frame — aggiorna zona corrente
  getCurrentZone()      // { zone, dist, tcActive, absActive, enteredAt }
  reset()               // chiama a inizio giro
}
```

---

### `src/main/main.js`

Entry point Electron. Responsabilità:

1. Crea finestra principale React (1200×800, no frame, `nodeIntegration: false`, `contextIsolation: true`)
2. Istanzia: `R3EReader` → `LapRecorder` → `AdaptiveBaseline` → `RuleEngine` + `AlertDispatcher`
3. IPC channels esposti al renderer via `contextBridge`:

```javascript
// Da main a renderer (push)
ipcMain.on('r3e:frame', handler)
ipcMain.on('r3e:alert', handler)
ipcMain.on('r3e:lapComplete', handler)
ipcMain.on('r3e:status', handler)  // { connected, calibrating, lapsToCalibration }

// Da renderer a main (request/response)
ipcMain.handle('db:getLaps', (event, { car, track }) => ...)
ipcMain.handle('db:getSession', (event, id) => ...)
ipcMain.handle('config:get', (event, key) => ...)
ipcMain.handle('config:set', (event, key, value) => ...)
```

4. Gestisce ciclo di vita: start reader all'avvio, stop su quit
5. Crea/aggiorna record sessione in SQLite a ogni `lapComplete`

---

### `src/main/coach/coach-engine.js`

Chiamato una volta per giro dopo `lapComplete`. Responsabilità:

1. Chiama Claude API (`claude-sonnet-4-6`) con il JSON del giro
2. Restituisce l'analisi in Template v3 italiano
3. Salva su SQLite (`laps.analysis_json`)
4. Invoca `generate_pdf.py` via `child_process.spawn` per export PDF
5. Emette risultato via IPC al renderer

```javascript
// API call parameters
model: 'claude-sonnet-4-6'
max_tokens: 4000
system: [system prompt con istruzioni Template v3]
messages: [{ role: 'user', content: buildPrompt(lapRecord, baselineDeviations) }]
```

---

### `src/main/coach/prompt-builder.js`

Costruisce il prompt per Claude a partire dal `LapRecord`.

Il prompt deve:

- Includere: tempo giro, tempi settori, numero giro, auto, circuito
- Includere: aggregati per zona (solo le zone con deviazioni significative)
- Includere: deviazioni dal baseline (già calcolate da `AdaptiveBaseline`)
- Includere: temperature freni (media e peak per asse)
- Chiedere output nel formato Template v3 (5 sezioni con header italiani)
- Se baseline non ancora calibrato → analisi standalone senza confronto

---

### `src/renderer/components/TTSManager.jsx`

Componente React (headless — nessun UI visibile). Gestisce Web Speech API.

```javascript
// Props
alerts: Alert[]           // da IPC r3e:alert
postLapText: string|null  // sintesi sezione 5 Template v3

// Behavior
- Coda priorità P1→P3
- P1 interrompe speechSynthesis.cancel() + parla subito
- Voce: it-IT, rate: 0.9, pitch: 1.0
- Testo post-giro: legge solo sezione [5] Sintesi del Template v3
- Espone: speak(text, priority), cancel(), isSpeaking()
```

---

### `src/renderer/components/Debriefing.jsx`

Pannello post-giro. Layout:

- Header: auto, circuito, tempo giro, delta vs best
- Body: testo Template v3 renderizzato (markdown → HTML)
- Footer: bottone "Esporta PDF", bottone "Confronta con giro precedente"
- Stato: "In attesa del giro..." / "Analisi in corso..." / risultato

---

### `src/renderer/components/StatusBar.jsx`

Barra di stato sempre visibile (bottom). Mostra:

- Stato connessione R3E (⬤ verde/rosso)
- Auto e circuito correnti
- "Calibrazione: 1 giro rimanente" oppure "🎙️ Coach attivo"
- Ultimo alert emesso (testo, fade out in 5s)

---

### `src/renderer/hooks/useIPC.js`

Custom hook React per ricevere dati da Electron main via `window.electronAPI`.

```javascript
// Espone
const { frame, alert, lapComplete, status } = useIPC();
```

---

### `src/shared/corner-names.json`

Seed data per i circuiti già usati nelle sessioni di analisi. Formato:

```json
{
  "Zolder|GP": [
    { "distMin": 100, "distMax": 250, "name": "Terlamenbocht" },
    { "distMin": 430, "distMax": 560, "name": "Sterrenwachtbocht" },
    { "distMin": 940, "distMax": 1080, "name": "Kanaalbocht" },
    { "distMin": 1590, "distMax": 1780, "name": "Gilles Villeneuvebocht" },
    { "distMin": 2160, "distMax": 2380, "name": "Lucien Bianchibocht" },
    { "distMin": 2860, "distMax": 3060, "name": "Bolderbergbocht" },
    { "distMin": 3450, "distMax": 3640, "name": "Jacky Ickxbocht" }
  ],
  "Hungaroring|GP": [],
  "Sachsenring|GP": [],
  "Brands Hatch|GP": []
}
```

Aggiungere circuiti al primo utilizzo dal layout della pista.

---

## Contesto analisi telemetria (per coach-engine.js)

### Template v3 — formato output atteso da Claude

L'analisi post-giro deve rispettare il formato già usato nelle sessioni:

```
[1] Analisi Telemetria       ← solo se ci sono dati frame sufficienti
[2] Setup Attuale vs Proposto ← omessa se non c'è setup noto
[3] Problemi Identificati    ← con dato numerico e marcatori @XXXm
[4] Raccomandazioni Modifiche
[5] Sintesi e Prossimo Step  ← questa sezione viene letta via TTS
```

La sezione [5] deve essere concisa (max 5 frasi) — viene letta ad alta voce.

### Finestra brake temps (da analisi esistenti)

- Freni anteriori: ideale 550°C ±137.5°C → finestra 413–688°C
- Freni posteriori: stessa finestra
- Se `BrakeTempActualEstimate` sempre -1 (non disponibile per questa auto) → non includere nel prompt

### Modalità Leaderboard / Qualify

Temperature gomme fisse a 85°C in Qualification/Leaderboard → non diagnosticare come problema.

---

## Note tecniche critiche

### ffi-napi su Electron

`ffi-napi` richiede rebuild nativo per la versione di Node usata da Electron:

```bash
npm install --save-dev electron-rebuild
npx electron-rebuild -f -w ffi-napi,ref-napi,better-sqlite3
```

Da aggiungere come script post-install in `package.json`.

### Verifica offset struct

Il primo test dopo `npm run test:reader` deve mostrare su console:

- velocità coerente con R3E (in km/h dopo conversione ×3.6)
- gear corretto (-1/0/1..n)
- throttle/brake in 0–1

Se i valori sono tutti 0 o -1: la struct ha un offset sbagliato. Verificare il campo `VersionMajor` a offset 0 — deve essere `2`.

Se `VersionMajor` è corretto ma gli altri campi no: il `PlayerData` inline ha dimensioni diverse dalla versione installata. Aprire il file `R3E.cs` dalla installazione di Second Monitor (`SecondMonitor/Connectors/R3E/`) per confrontare la struct.

### mock mode

Su macOS/Linux (sviluppo): `R3EReader` entra automaticamente in mock mode con frame simulati ogni 16ms e un finto `lapComplete` ogni ~90s. Tutto il resto del sistema funziona identico.

---

## Stato avanzamento

| Modulo                     | Stato       |
| -------------------------- | ----------- |
| r3e-struct.js              | ✅ Completo |
| r3e-reader.js              | ✅ Completo |
| lap-recorder.js            | ✅ Completo |
| adaptive-baseline.js       | ✅ Completo |
| rule-engine.js             | ✅ Completo |
| db.js                      | ✅ Completo |
| zone-tracker.js            | ❌          |
| main.js                    | ❌          |
| coach-engine.js            | ❌          |
| prompt-builder.js          | ❌          |
| TTSManager.jsx             | ❌          |
| Debriefing.jsx             | ❌          |
| StatusBar.jsx              | ❌          |
| App.jsx / index.html       | ❌          |
| useIPC.js                  | ❌          |
| corner-names.json          | ❌          |
| generate_pdf.py            | ❌          |
| electron-builder.config.js | ❌          |

---

## Come usare questo documento in Claude Code

1. Aprire una nuova sessione Claude Code nella cartella `r3e-driving-coach/`
2. Allegare questo file come contesto
3. I file già scritti sono presenti su disco — Claude Code può leggerli direttamente
4. Richiedere i moduli rimanenti nell'ordine: `zone-tracker.js` → `main.js` → `coach-engine.js` + `prompt-builder.js` → layer renderer
5. Per il test iniziale: `npm install && npx electron-rebuild -f -w ffi-napi,ref-napi,better-sqlite3 && npm run test:reader`
