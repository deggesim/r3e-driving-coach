# Migrazione electron-vite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il build system attuale (tsc + vite + concurrently) con electron-vite per ottenere hot-reload del main process, config unificata e script semplificati.

**Architecture:** Un solo `electron.vite.config.ts` gestisce i tre bundle (main ESM, preload CJS, renderer ESM+HMR). Il preload viene spostato da `src/main/preload.cts` a `src/preload/index.ts` — electron-vite compila in CJS automaticamente. `@electron-toolkit/utils` sostituisce la variabile locale `IS_DEV` con `is.dev` e fornisce il pattern standard per il caricamento della finestra via `process.env['ELECTRON_RENDERER_URL']`.

**Tech Stack:** electron-vite v5, @electron-toolkit/utils, @electron-toolkit/preload, @vitejs/plugin-react, electron-builder (invariato)

---

## File Map

| Azione | File |
|--------|------|
| Creare | `electron.vite.config.ts` |
| Creare | `src/preload/index.ts` |
| Creare | `tsconfig.web.json` |
| Modificare | `package.json` |
| Modificare | `tsconfig.json` |
| Modificare | `tsconfig.node.json` |
| Modificare | `src/main/main.ts` |
| Modificare | `electron-builder.yml` |
| Modificare | `.gitignore` |
| Eliminare | `vite.config.ts` |
| Eliminare | `src/main/preload.cts` |

---

## Task 1: Aggiungere `out/` al `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Aggiungere la riga `out/` al .gitignore**

Aprire `.gitignore` e aggiungere `out/` dopo la riga `dist/`:

```
node_modules/
dist/
out/
release/
*.js.map
*.d.ts.map
.env
.env.local
*.log
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add out/ to .gitignore for electron-vite output"
```

---

## Task 2: Installare e disinstallare dipendenze

**Files:**
- Modify: `package.json` (automatico via npm)

- [ ] **Step 1: Installare le nuove dipendenze**

```bash
npm install @electron-toolkit/utils @electron-toolkit/preload
npm install -D electron-vite
```

- [ ] **Step 2: Disinstallare le dipendenze non più necessarie**

```bash
npm uninstall concurrently wait-on
```

- [ ] **Step 3: Verificare che `package.json` contenga le dipendenze corrette**

```bash
node -e "const p = require('./package.json'); console.log('ADD:', ['electron-vite','@electron-toolkit/utils','@electron-toolkit/preload'].map(d => d + ': ' + (p.devDependencies?.[d] || p.dependencies?.[d] || 'MISSING'))); console.log('REMOVE:', ['concurrently','wait-on'].map(d => d + ': ' + (p.devDependencies?.[d] || 'ok (removed)')))"
```

Risultato atteso: tutte e tre le nuove dipendenze presenti, `concurrently` e `wait-on` segnati come `ok (removed)`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install electron-vite and @electron-toolkit, remove concurrently/wait-on"
```

---

## Task 3: Creare `electron.vite.config.ts` e rimuovere `vite.config.ts`

**Files:**
- Create: `electron.vite.config.ts`
- Delete: `vite.config.ts`

- [ ] **Step 1: Creare `electron.vite.config.ts`**

Creare il file nella root del progetto con il seguente contenuto:

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // Chiave "main" → output: out/main/main.js (allineato con "main" in package.json)
        input: { main: resolve(__dirname, 'src/main/main.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  }
})
```

Note sul config:
- `build.externalizeDeps: true` è il default in electron-vite v5 — `better-sqlite3` e `koffi` restano external senza config esplicita.
- Il preload non importa da `@shared`, quindi non ha bisogno dell'alias.
- Gli `outDir` di default di electron-vite v5 sono già `out/main`, `out/preload`, `out/renderer`.

- [ ] **Step 2: Eliminare `vite.config.ts`**

```bash
git rm vite.config.ts
```

- [ ] **Step 3: Commit**

```bash
git add electron.vite.config.ts
git commit -m "build: add electron.vite.config.ts, remove vite.config.ts"
```

---

## Task 4: Spostare il preload in `src/preload/index.ts`

**Files:**
- Create: `src/preload/index.ts`
- Delete: `src/main/preload.cts`

- [ ] **Step 1: Creare la directory `src/preload/`**

```bash
mkdir src/preload
```

- [ ] **Step 2: Creare `src/preload/index.ts`**

Il contenuto è identico a `src/main/preload.cts` ma senza il commento CJS (electron-vite gestisce il target CJS automaticamente). Il file usa import ES module — electron-vite lo compilerà in CJS nell'output:

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Main → Renderer (push channels)
  onFrame: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:frame", listener);
    return () => ipcRenderer.removeListener("session:frame", listener);
  },
  onLapComplete: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("lapComplete", listener);
    return () => ipcRenderer.removeListener("lapComplete", listener);
  },
  onStatus: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("status", listener);
    return () => ipcRenderer.removeListener("status", listener);
  },

  onAppError: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("app:error", listener);
    return () => ipcRenderer.removeListener("app:error", listener);
  },

  onInputTrigger: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("input:trigger", listener);
    return () => ipcRenderer.removeListener("input:trigger", listener);
  },

  onVoiceChunk: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("coach:voiceChunk", listener);
    return () => ipcRenderer.removeListener("coach:voiceChunk", listener);
  },
  onVoiceDone: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("coach:voiceDone", listener);
    return () => ipcRenderer.removeListener("coach:voiceDone", listener);
  },
  onVoiceAudio: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("coach:voiceAudio", listener);
    return () => ipcRenderer.removeListener("coach:voiceAudio", listener);
  },

  onSessionStarted: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:started", listener);
    return () => ipcRenderer.removeListener("session:started", listener);
  },
  onSessionClosed: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:closed", listener);
    return () => ipcRenderer.removeListener("session:closed", listener);
  },
  onSessionLapAdded: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:lapAdded", listener);
    return () => ipcRenderer.removeListener("session:lapAdded", listener);
  },
  onSessionSetupLoaded: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:setupLoaded", listener);
    return () => ipcRenderer.removeListener("session:setupLoaded", listener);
  },
  onSessionAnalysisChunk: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:analysisChunk", listener);
    return () => ipcRenderer.removeListener("session:analysisChunk", listener);
  },
  onSessionAnalysisDone: (callback: (data: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on("session:analysisDone", listener);
    return () => ipcRenderer.removeListener("session:analysisDone", listener);
  },

  configGet: (key: string) => ipcRenderer.invoke("config:get", key),
  configSet: (key: string, value: unknown) =>
    ipcRenderer.invoke("config:set", key, value),

  sessionStart: () => ipcRenderer.invoke("session:start"),
  sessionEnd: () => ipcRenderer.invoke("session:end"),
  sessionAnalyze: (params?: { sessionId?: number; game?: string; leaderboardMode?: boolean; fixedSetup?: boolean }) =>
    ipcRenderer.invoke("session:analyze", params ?? {}),
  sessionLoadSetup: (params: { setup: unknown; sessionId?: number; game?: string }) =>
    ipcRenderer.invoke("session:loadSetup", params),
  sessionList: (params: unknown) => ipcRenderer.invoke("session:list", params),
  sessionGetCurrent: () => ipcRenderer.invoke("session:getCurrent"),
  sessionGetDetail: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:getDetail", params),
  sessionExportPdf: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:exportPdf", params),
  sessionDelete: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:delete", params),
  sessionDeleteAll: (items: Array<{ id: number; game: string }>) =>
    ipcRenderer.invoke("session:deleteAll", items),
  sessionReopen: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:reopen", params),
  sessionGetSetupHistory: (params: { car: string; track: string; layout: string; game: string }) =>
    ipcRenderer.invoke("session:getSetupHistory", params),
  sessionReuseSetup: (params: { setupId: number }) =>
    ipcRenderer.invoke("session:reuseSetup", params),
  sessionDeleteAnalysis: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:deleteAnalysis", params),

  lapGetFrames: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("lap:getFrames", params),
  lapAssignSetup: (params: { lapId: number; setupId: number | null; game: string }) =>
    ipcRenderer.invoke("lap:assignSetup", params),
  lapDelete: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("lap:delete", params),

  trackMapGet: (params: { game: string; track: string; layout: string }) =>
    ipcRenderer.invoke("trackMap:get", params),

  voiceQuery: (question: string) =>
    ipcRenderer.invoke("coach:voiceQuery", question),

  sttTranscribe: (audioBuffer: ArrayBuffer, mimeType?: string): Promise<string> =>
    ipcRenderer.invoke("stt:transcribe", audioBuffer, mimeType),

  ttsGetVoices: () => ipcRenderer.invoke("tts:getVoices"),
  ttsSynthesize: (text: string) => ipcRenderer.invoke("tts:synthesize", text),
  ttsTest: (voiceName: string) => ipcRenderer.invoke("tts:test", voiceName),

  windowClose: () => ipcRenderer.send("window:close"),
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowMaximize: () => ipcRenderer.send("window:maximize"),

  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  telemetryLogGetDir: () => ipcRenderer.invoke("telemetry:getLogDir"),

  aceListSetupCars: () => ipcRenderer.invoke("ace:listSetupCars"),
  aceListSetupTracks: (params: { car: string }) =>
    ipcRenderer.invoke("ace:listSetupTracks", params),
  aceListSetupFiles: (params: { car: string; track: string }) =>
    ipcRenderer.invoke("ace:listSetupFiles", params),
  aceReadSetup: (params: { filePath: string }) =>
    ipcRenderer.invoke("ace:readSetup", params),
});
```

- [ ] **Step 3: Eliminare `src/main/preload.cts`**

```bash
git rm src/main/preload.cts
```

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts
git commit -m "refactor: move preload from src/main/preload.cts to src/preload/index.ts"
```

---

## Task 5: Aggiornare la struttura tsconfig

**Files:**
- Modify: `tsconfig.json`
- Modify: `tsconfig.node.json`
- Create: `tsconfig.web.json`

- [ ] **Step 1: Aggiornare `tsconfig.json` — diventa base condivisa pura**

Sostituire l'intero contenuto di `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strictNullChecks": true
  }
}
```

Nota: rimosso `module`, `outDir`, `rootDir`, `jsx`, `lib`, `types`, `include`, `exclude` — questi vengono ora ereditati e specializzati dai tsconfig figlio.

- [ ] **Step 2: Aggiornare `tsconfig.node.json` — main + preload**

Sostituire l'intero contenuto di `tsconfig.node.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "outDir": "out",
    "types": ["electron-vite/node"]
  },
  "include": [
    "electron.vite.config.ts",
    "src/main/**/*.ts",
    "src/preload/**/*.ts",
    "src/shared/**/*.ts"
  ]
}
```

Nota: `types: ["electron-vite/node"]` fornisce i tipi per `import.meta.env.DEV` e le variabili di ambiente iniettate da electron-vite (come `ELECTRON_RENDERER_URL`).

- [ ] **Step 3: Creare `tsconfig.web.json` — renderer**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "jsx": "react-jsx",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "outDir": "out"
  },
  "include": [
    "src/renderer/**/*.ts",
    "src/renderer/**/*.tsx",
    "src/shared/**/*.ts"
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json tsconfig.node.json tsconfig.web.json
git commit -m "build: restructure tsconfig for electron-vite (node + web split)"
```

---

## Task 6: Aggiornare `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Aggiornare il campo `main` e gli script**

Nel `package.json`, modificare il campo `"main"` e la sezione `"scripts"`:

```json
{
  "main": "out/main/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "build:electron": "electron-vite build && electron-builder",
    "typecheck": "electron-vite typecheck",
    "start": "electron-vite preview",
    "lint": "eslint .",
    "rebuild:native": "npx @electron/rebuild -f -w better-sqlite3",
    "migrate:dates": "node scripts/migrate-dates.cjs"
  }
}
```

Script rimossi: `dev:vite` (non più necessario).

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "build: update package.json scripts and main field for electron-vite"
```

---

## Task 7: Aggiornare `src/main/main.ts`

**Files:**
- Modify: `src/main/main.ts`

Quattro modifiche puntuali. Applicarle nell'ordine indicato.

- [ ] **Step 1: Aggiungere import `is` e rimuovere `IS_DEV`**

Aggiungere dopo gli import esistenti di Electron (riga ~11):

```ts
import { is } from "@electron-toolkit/utils";
```

Rimuovere la riga (riga ~88):

```ts
const IS_DEV = !app.isPackaged;
```

- [ ] **Step 2: Aggiornare il path del preload** (nella funzione `createWindow`, `webPreferences`)

```ts
// Prima
preload: path.join(__dirname, "preload.cjs"),

// Dopo
preload: path.join(__dirname, "../preload/index.js"),
```

- [ ] **Step 3: Aggiornare il blocco CSP dev** (righe ~127-145)

```ts
// Prima
const csp = IS_DEV
  ? [
      "default-src 'self' http://localhost:5173",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:5173",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src blob:",
      "connect-src ws://localhost:5173 http://localhost:5173",
      "font-src 'self' data:",
    ].join("; ")

// Dopo
const devUrl = process.env["ELECTRON_RENDERER_URL"] ?? "http://localhost:5173";
const devOrigin = new URL(devUrl).origin;
const devHost = new URL(devUrl).host;
const csp = is.dev
  ? [
      `default-src 'self' ${devOrigin}`,
      `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${devOrigin}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src blob:",
      `connect-src ws://${devHost} ${devOrigin}`,
      "font-src 'self' data:",
    ].join("; ")
```

La parte `: [...]` per la produzione rimane invariata.

- [ ] **Step 4: Aggiornare `will-navigate` e il caricamento della finestra** (righe ~159-179)

```ts
// Prima
const allowedOrigins = IS_DEV
  ? ["http://localhost:5173"]
  : [`file://${path.join(__dirname, "../renderer")}`];

// Dopo
const allowedOrigins = is.dev
  ? [process.env["ELECTRON_RENDERER_URL"] ?? "http://localhost:5173"]
  : [`file://${path.join(__dirname, "../renderer")}`];
```

```ts
// Prima
if (IS_DEV) {
  mainWindow.loadURL("http://localhost:5173");
  mainWindow.webContents.openDevTools();
} else {
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

// Dopo
if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
  mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  mainWindow.webContents.openDevTools();
} else {
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}
```

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts
git commit -m "refactor(main): use is.dev and ELECTRON_RENDERER_URL from electron-toolkit"
```

---

## Task 8: Aggiornare `electron-builder.yml`

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1: Sostituire le directory `dist/` con `out/` nella sezione `files`**

Nella sezione `files`, sostituire:

```yaml
# Prima
files:
  - dist/main/**/*
  - dist/renderer/**/*
  - dist/shared/**/*
  - package.json
  - node_modules/**/*
  ...

# Dopo
files:
  - out/main/**/*
  - out/preload/**/*
  - out/renderer/**/*
  - package.json
  - node_modules/**/*
  ...
```

Note:
- `dist/shared/**/*` viene rimosso: electron-vite bundle il codice shared direttamente in `out/main/main.js`
- `out/preload/**/*` è una riga nuova (prima il preload era in `dist/main/`)
- La sezione `asarUnpack` rimane invariata (riguarda solo i `.node` nativi in `node_modules/`)

- [ ] **Step 2: Commit**

```bash
git add electron-builder.yml
git commit -m "build: update electron-builder.yml output paths from dist/ to out/"
```

---

## Task 9: Verifica build di produzione

**Nessun file da modificare — solo verifica**

- [ ] **Step 1: Eseguire il build**

```bash
npm run build
```

Risultato atteso: nessun errore, creazione delle directory `out/main/`, `out/preload/`, `out/renderer/`.

- [ ] **Step 2: Verificare che i file di output esistano**

```powershell
@("out/main/main.js", "out/preload/index.js", "out/renderer/index.html") | ForEach-Object { Test-Path $_ }
```

Risultato atteso: tre righe `True`.

- [ ] **Step 3: Eseguire il type-check**

```bash
npm run typecheck
```

Risultato atteso: nessun errore TypeScript.

- [ ] **Step 4: In caso di errori di tipo**

Errori comuni e soluzioni:
- `Cannot find name 'ELECTRON_RENDERER_URL'` — verificare che `tsconfig.node.json` includa `"types": ["electron-vite/node"]`
- `Module '@electron-toolkit/utils' not found` — eseguire `npm install` per assicurarsi che le dipendenze siano installate
- `Property 'is' does not exist` — verificare che l'import sia `import { is } from "@electron-toolkit/utils"`

- [ ] **Step 5: Commit se tutto passa**

```bash
git add -A
git commit -m "build: verify electron-vite build and typecheck pass"
```

---

## Task 10: Verifica in modalità sviluppo

**Nessun file da modificare — solo verifica**

- [ ] **Step 1: Avviare l'app in modalità dev**

```bash
npm run dev
```

Risultato atteso:
- Il terminale mostra `electron-vite dev` con output dei tre bundle (main, preload, renderer)
- La finestra Electron si apre con il renderer caricato (`http://localhost:5173` o porta assegnata da electron-vite)
- DevTools aperte automaticamente
- Il simulatore non è necessario per questa verifica — basta che la UI si carichi senza errori nella console

- [ ] **Step 2: Verificare il hot-reload del main**

Fare una modifica banale in `src/main/main.ts` (es. aggiungere `console.log("hot reload test")`), salvare.

Risultato atteso: electron-vite riavvia automaticamente il processo main senza dover killare e rilanciare manualmente.

- [ ] **Step 3: Ripristinare la modifica di test**

Rimuovere il `console.log` aggiunto nel passo precedente.

- [ ] **Step 4: Commit finale**

```bash
git add -A
git commit -m "chore: electron-vite migration complete"
```

---

## Riepilogo

| Task | Scope |
|------|-------|
| 1 | .gitignore: aggiungere `out/` |
| 2 | npm: install electron-vite + toolkit, uninstall concurrently/wait-on |
| 3 | electron.vite.config.ts: crea; vite.config.ts: elimina |
| 4 | src/preload/index.ts: crea; src/main/preload.cts: elimina |
| 5 | tsconfig.json, tsconfig.node.json, tsconfig.web.json |
| 6 | package.json: script + main field |
| 7 | src/main/main.ts: is.dev + preload path + CSP + window load |
| 8 | electron-builder.yml: dist/ → out/ |
| 9 | Verifica build + typecheck |
| 10 | Verifica dev mode + hot-reload |
