# Sim Driving Coach — Briefing per Claude Code

## Contesto del progetto

App Electron + React che funge da **voice coach in tempo reale** per simulatori di guida. Supporta due simulatori: **RaceRoom Racing Experience (R3E)** e **Assetto Corsa EVO (ACE)**. Legge la shared memory direttamente (Windows API via koffi), analizza la tecnica di guida e produce alert vocali in italiano durante il giro. Dopo il giro, chiama Claude API per un debriefing completo nel Template v3.

---

## Decisioni di design già prese (non riaprire)

| Parametro              | Scelta                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Simulatori supportati  | R3E e ACE — selezionabili dalle impostazioni (`activeGame`)                                |
| Sorgente dati R3E      | Shared Memory `$R3E` via `koffi` + kernel32.dll                                           |
| Sorgente dati ACE      | Tre pagine SHM (PhysicsEvo, GraphicsEvo, StaticEvo) via `koffi`                           |
| Polling rate           | 16ms (`setTimeout`, non `setInterval`)                                                     |
| Output durante il giro | **Solo audio** — alert TTS in italiano, alert-driven                                      |
| Output post-giro       | Debriefing voce + testo Template v3 + export PDF                                          |
| Alert durante il giro  | **Solo quando c'è un problema** (no delta continuo)                                       |
| Soglie alert           | **Adattive** — calibrazione automatica nei primi 2 giri                                   |
| Timing alert           | Immediato per P1/P2, post-curva per P3                                                    |
| Modello AI analisi     | `claude-haiku-4-5-20251001` per analisi giro; `claude-sonnet-4-6` per voice queries       |
| Setup R3E              | Screenshot Steam → Claude Vision → `SetupData`                                            |
| Setup ACE              | File `.carsetup` da `D:\Salvataggi\ACE\Car Setups\{car}\{track}\` → decode protobuf       |
| Delete analisi         | Singola (`db:deleteLap`) e massiva (`db:deleteAllLaps`) con routing per gioco             |
| UI durante il giro     | Nessuna — solo audio                                                                       |
| UI post-giro           | Pannello Debriefing + SessionHistory con filtri e delete                                  |
| Lingua                 | Italiano (voce e UI)                                                                       |
| Platform target        | Windows only                                                                               |
| Build                  | Electron + Vite + React 18 + TypeScript strict                                            |

---

## Architettura

```
activeGame config (r3e | ace)
              │
              ▼
   R3EReader  ──── oppure ────  AceReader
   (koffi $R3E)              (koffi PhysicsEvo + GraphicsEvo + StaticEvo)
        │                              │
        └──────────────┬───────────────┘
                       │  GameFrame (5 campi unificati)
                       ▼
    ZoneTracker → RuleEngine (P1/P2 immediati)
                       │
                  AlertDispatcher
                       │
               TTSManager (Azure TTS / Web Speech)

    onLapComplete → LapRecorder → AdaptiveBaseline → RuleEngine (P3 post-curva)
                                          │
                                     CoachEngine → Claude API → Template v3
                                          │                         │
                                      SQLite DB           PdfGenerator + Debriefing.tsx

    Gamepad button held
        → MediaRecorder
        → IPC: stt:transcribe (Azure STT)
        → IPC: coach:voiceQuery
        → VoiceCoach streams Claude
        → IPC: coach:voiceChunk / coach:voiceDone / coach:voiceAudio
        → VoiceCoachOverlay + Azure TTS playback
```

---

## Struttura progetto attuale

```
sim-driving-coach/
├── src/
│   ├── main/
│   │   ├── main.ts                     ✅ Entry point Electron (~50 IPC handlers)
│   │   ├── preload.ts                  ✅ Context bridge (40+ canali)
│   │   ├── game-adapter.ts             ✅ R3EFrame → GameFrame
│   │   ├── pdf-generator.ts            ✅ printToPDF + HTML/CSS
│   │   ├── r3e/
│   │   │   ├── r3e-struct.ts           ✅ Struct v14.0+, Pack=4, 1324 bytes
│   │   │   ├── r3e-reader.ts           ✅ SHM via koffi, mock fallback
│   │   │   ├── r3e-data-loader.ts      ✅ r3e-data.json → nomi auto/circuito
│   │   │   ├── lap-recorder.ts         ✅ Aggregatore zone 50m, calibrazione
│   │   │   └── zone-tracker.ts         ✅ Tracker zona corrente
│   │   ├── ace/
│   │   │   ├── ace-struct.ts           ✅ Tre pagine SHM ACE
│   │   │   ├── ace-reader.ts           ✅ SHM via koffi, mock fallback
│   │   │   └── ace-setup-reader.ts     ✅ Decode protobuf .carsetup
│   │   ├── coach/
│   │   │   ├── adaptive-baseline.ts    ✅ EMA α=0.3, game-aware
│   │   │   ├── rule-engine.ts          ✅ AlertDispatcher P1→P3
│   │   │   ├── coach-engine.ts         ✅ Claude Haiku per giro
│   │   │   ├── prompt-builder.ts       ✅ Prompt Template v3
│   │   │   └── voice-coach.ts          ✅ Streaming Claude Sonnet
│   │   ├── tts/
│   │   │   └── azure-tts.ts            ✅ TTS + STT Azure
│   │   └── db/
│   │       └── db.ts                   ✅ Schema dual-game (vedi sotto)
│   ├── renderer/
│   │   ├── main.tsx                    ✅ Entry React
│   │   ├── components/
│   │   │   ├── App.tsx                 ✅ Layout tabs + title bar
│   │   │   ├── Debriefing.tsx          ✅ Live telemetria + last lap
│   │   │   ├── StatusBar.tsx           ✅ Connessione + calibrazione
│   │   │   ├── SessionHistory.tsx      ✅ Lista giri R3E+ACE, delete, PDF
│   │   │   ├── SettingsPanel.tsx       ✅ API key, gioco, TTS, gamepad
│   │   │   ├── TTSManager.tsx          ✅ Web Speech API fallback
│   │   │   ├── VoiceCoachOverlay.tsx   ✅ Overlay mic/streaming
│   │   │   ├── ScreenshotPicker.tsx    ✅ Setup R3E via screenshot
│   │   │   └── AceSetupPicker.tsx      ✅ Setup ACE via file .carsetup
│   │   ├── hooks/
│   │   │   ├── useIPC.ts               ✅ Subscriptions + useConfig()
│   │   │   ├── useVoiceCoach.ts        ✅ Gamepad → STT → coach → TTS
│   │   │   └── useGamepad.ts           ✅ navigator.getGamepads()
│   │   ├── store/
│   │   │   ├── ipcStore.ts             ✅ Zustand: frame/alert/lap/status
│   │   │   └── settingsStore.ts        ✅ Zustand: settings + activeGame
│   │   └── mocks/
│   │       └── mockLap.ts              ✅ Mock lap per dev/test
│   └── shared/
│       ├── types.ts                    ✅ GameSource, GameFrame, LapRow...
│       ├── format.ts                   ✅ formatLapTime()
│       ├── alert-types.ts              ✅ Costanti P1/P2/P3 + soglie
│       └── corner-names.json           ✅ Seed dati nomi curve
```

---

## Schema database (db.ts)

```sql
-- Tabelle R3E (IDs numerici)
sessions_r3e (id, car, track, layout, session_type, started_at, best_lap, lap_count)
laps_r3e     (id, session_id, lap_number, lap_time, sector1/2/3, valid,
              analysis_json, pdf_path, recorded_at)

-- Tabelle ACE (IDs stringa: "monza", "ks_porsche_718_gt4")
sessions_ace (id, car, track, layout, session_type, started_at, best_lap, lap_count)
laps_ace     (id, session_id, lap_number, lap_time, sector1/2/3, valid,
              analysis_json, pdf_path, setup_json, setup_screenshots, recorded_at)

-- Tabelle condivise
baseline           (game, car, track, zone_id, data JSON, updated_at)
baseline_tc_zones  (game, car, track, zone_id)
baseline_abs_zones (game, car, track, zone_id)
corner_names       (track, layout, dist_min, dist_max, name)
app_config         (key, value)
```

---

## Funzionalità setup

### R3E — Screenshot Steam
1. `SessionHistory` → "Aggiungi Setup" → apre `ScreenshotPicker`
2. Utente seleziona screenshot della schermata setup in-game
3. IPC `setup:decodeSetup` → Claude Vision API → `SetupData` (params con label italiano)
4. Salvo in `laps_r3e.setup_json` (non esiste ancora — attualmente in `laps_r3e` non c'è setup_json; vedi discrepanze)

### ACE — File .carsetup
1. `SessionHistory` → "Aggiungi Setup" → apre `AceSetupPicker`
2. IPC `ace:listSetupFiles { car, track }` → lista file da `D:\Salvataggi\ACE\Car Setups\`
3. Utente seleziona file → IPC `ace:readSetup { filePath }` → decode protobuf → `SetupData`
4. Salvo in `laps_ace.setup_json`

---

## Delete analisi

| Operazione   | IPC Handler              | Payload               |
| ------------ | ------------------------ | --------------------- |
| Singola      | `db:deleteLap`           | `{ id, game }`        |
| Massiva      | `db:deleteAllLaps`       | `[{ id, game }]`      |

Il main process fa routing: `game === "r3e"` → `DELETE FROM laps_r3e`, `game === "ace"` → `DELETE FROM laps_ace`. Le cancellazioni massive sono in transazione.

---

## Impostazioni (SettingsPanel.tsx + settingsStore.ts)

| Setting           | Tipo       | Descrizione                                         |
| ----------------- | ---------- | --------------------------------------------------- |
| `apiKey`          | string     | Anthropic API key                                   |
| `assistantName`   | string     | Nome del coach (default "Aria")                     |
| `activeGame`      | "r3e"/"ace"| Simulatore attivo — cambia reader al riavvio        |
| `gamepadButton`   | number     | Indice tasto gamepad per attivare il microfono      |
| `ttsEnabled`      | boolean    | Abilita coach vocale                                |
| `azureTtsEnabled` | boolean    | Usa Azure TTS invece di Web Speech API              |
| `azureSpeechKey`  | string     | Azure Cognitive Services key                        |
| `azureRegion`     | string     | Azure region (default "westeurope")                 |
| `azureVoiceName`  | string     | Voice Azure selezionata                             |
| `mockHistoryMode` | boolean    | Dev mode: usa MOCK_LAP in SessionHistory            |

---

## Priorità alert

| Priorità | Tipo                | Timing                      | Esempio messaggio                                                 |
| -------- | ------------------- | --------------------------- | ----------------------------------------------------------------- |
| P1       | Brake temp critica  | Immediato, interrompe tutto | "Freni anteriori a 695 gradi — zona critica"                      |
| P2       | TC/ABS zona anomala | Immediato, coda             | "TC attivo alla Bianchibocht — zona insolita"                     |
| P3       | Tecnica di guida    | Post-curva, max 1/zona/giro | "Bianchibocht, metro 2209: frenato 18 metri dopo il riferimento"  |

**Anti-spam**: max 1 alert per `(zona × tipo)` per giro, silence window 4s, no P3 entro 3s dall'ingresso zona.

---

## Template v3 — formato output atteso da Claude

```
[1] Analisi Telemetria       ← solo se ci sono dati frame sufficienti
[2] Setup Attuale vs Proposto ← omessa se non c'è setup noto
[3] Problemi Identificati    ← con dato numerico e marcatori @XXXm
[4] Raccomandazioni Modifiche
[5] Sintesi e Prossimo Step  ← letta via TTS (max 5 frasi)
```

---

## Note tecniche

### koffi su Electron
`koffi` (FFI per shared memory) non richiede rebuild nativo. `better-sqlite3` sì:
```bash
npm run rebuild:native   # usa electron-rebuild internamente
```

### Identificatori ACE
ACE espone car/track come stringhe leggibili dalla SHM (niente lookup file come r3e-data.json). Non applicare R3EDataLoader su sessioni ACE.

### Verifica offset struct R3E
- `VersionMajor` a offset 0 deve essere `3`
- Se KO: confrontare con `R3E.cs` da SecondMonitor Connectors

### Verifica ACE
- `status` in PhysicsEvo deve essere `AC_LIVE = 2`
- Se 0: ACE non è in esecuzione o non è in sessione

---

## Discrepanze da risolvere

1. **`laps_r3e` manca `setup_json`/`setup_screenshots`**: queste colonne esistono solo in `laps_ace`. Se si vuole supportare setup anche per R3E in SessionHistory, aggiungere le colonne (con migration) o usare una tabella `setups` separata
2. **`coach-engine.ts` usa `claude-haiku-4-5-20251001`**: CLAUDE.md precedente indicava `claude-sonnet-4-6`. Haiku è più veloce/economico per analisi per-giro; Sonnet è usato solo per voice queries
3. **`activeGame` config**: cambio gioco richiede riavvio dell'app (il reader viene selezionato all'avvio di main.ts). Comunicarlo in UI
4. **ACE setup path hardcoded**: `D:\Salvataggi\ACE\Car Setups\` — potrebbe essere configurabile da impostazioni
