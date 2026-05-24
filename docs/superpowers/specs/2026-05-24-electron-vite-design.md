# Design: Migrazione da Vite a electron-vite

**Data:** 2026-05-24  
**Stato:** Approvato  
**Scope:** Build system — nessuna modifica a logica di business, IPC, store, componenti React, database

---

## Motivazione

- **DX nel main process:** hot-reload del processo main e preload durante lo sviluppo (oggi richiede kill + riavvio manuale)
- **Config unificata:** un solo `electron.vite.config.ts` al posto di `vite.config.ts` + `tsconfig.node.json` come driver di compilazione
- **Standard de-facto:** electron-vite è il template ufficiale raccomandato dalla community Electron
- **Script semplificati:** `electron-vite dev` sostituisce `tsc && concurrently "vite" "wait-on ... && electron ."`

---

## Architettura del nuovo Build System

### Prima

```
tsc -p tsconfig.node.json  →  dist/main/      (main process)
vite                       →  dist/renderer/  (renderer)
concurrently + wait-on orchestrano i due processi in dev
```

### Dopo

```
electron-vite dev    →  avvia main + preload + renderer in parallelo con watch/HMR
electron-vite build  →  out/main/ + out/preload/ + out/renderer/
```

electron-vite gestisce internamente tre bundle:

| Layer | Formato output | Note |
|-------|---------------|------|
| main | ESM | `build.externalizeDeps: true` per default (v5) — `better-sqlite3`, `koffi` restano external automaticamente |
| preload | CJS | Sempre CJS indipendentemente da `"type": "module"` in `package.json` |
| renderer | ESM + HMR | Identico all'attuale Vite/React |

Il renderer è già compatibile: `src/renderer/index.html` + `src/renderer/main.tsx` corrispondono alle convenzioni di electron-vite. Il main è auto-rilevato come `src/main/main.ts`.

---

## File interessati dal refactoring

### Nuovi file

| File | Scopo |
|------|-------|
| `electron.vite.config.ts` | Config unificata main + preload + renderer. Sostituisce `vite.config.ts` |
| `src/preload/index.ts` | Preload spostato da `src/main/preload.cts`. electron-vite compila in CJS automaticamente; `.cts` non serve più |
| `tsconfig.web.json` | tsconfig dedicato al renderer (senza `types: ["node"]`, con `lib: ["DOM"]`) |

### File modificati

| File | Modifiche |
|------|-----------|
| `package.json` | Script semplificati, dipendenze aggiornate, `main` field aggiornato |
| `tsconfig.json` | Diventa base condivisa pura (non compila direttamente nulla) |
| `tsconfig.node.json` | Aggiunto `types: ["electron-vite/node"]`, include `src/preload/` e `electron.vite.config.ts` |
| `src/main/main.ts` | 4 modifiche puntuali (vedi sotto) |
| `electron-builder.yml` | `dist/` → `out/` in `files` |

### File eliminati

| File | Perché |
|------|--------|
| `vite.config.ts` | Sostituito da `electron.vite.config.ts` |
| `src/main/preload.cts` | Spostato in `src/preload/index.ts` |

---

## Dipendenze

### Aggiungere

```
devDependencies:  electron-vite
dependencies:     @electron-toolkit/utils
                  @electron-toolkit/preload
```

### Rimuovere

```
devDependencies:  concurrently
                  wait-on
```

---

## Dettaglio: `electron.vite.config.ts`

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

Note:
- `build.externalizeDeps: true` è il default v5 — nessuna config esplicita per i moduli nativi
- Il preload non importa da `src/shared`, quindi non necessita dell'alias
- Gli `outDir` di default sono già `out/main`, `out/preload`, `out/renderer`

---

## Dettaglio: script `package.json`

```json
{
  "main": "out/main/main.js",
  "scripts": {
    "dev":            "electron-vite dev",
    "build":          "electron-vite build",
    "build:electron": "electron-vite build && electron-builder",
    "typecheck":      "electron-vite typecheck",
    "start":          "electron-vite preview",
    "rebuild:native": "npx @electron/rebuild -f -w better-sqlite3",
    "lint":           "eslint .",
    "migrate:dates":  "node scripts/migrate-dates.cjs"
  }
}
```

`dev:vite` viene rimosso (non più necessario con `electron-vite dev`).

---

## Dettaglio: modifiche a `src/main/main.ts`

### 1. Import `is` da `@electron-toolkit/utils`

```ts
// Aggiungere
import { is } from '@electron-toolkit/utils'

// Rimuovere
const IS_DEV = !app.isPackaged;
```

Sostituire tutte le occorrenze di `IS_DEV` con `is.dev`.

### 2. Path del preload

```ts
// Prima
preload: path.join(__dirname, "preload.cjs"),

// Dopo
preload: join(__dirname, '../preload/index.js'),
```

### 3. Caricamento della finestra

```ts
// Prima
if (IS_DEV) {
  mainWindow.loadURL("http://localhost:5173");
  mainWindow.webContents.openDevTools();
} else {
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

// Dopo
if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
  mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  mainWindow.webContents.openDevTools();
} else {
  mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}
```

### 4. CSP dev — origin dinamico

```ts
// Prima
const csp = IS_DEV ? [
  "default-src 'self' http://localhost:5173",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:5173",
  "connect-src ws://localhost:5173 http://localhost:5173",
  ...
] : [...]

// Dopo
const devUrl = process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173';
const devOrigin = new URL(devUrl).origin;
const devHost = new URL(devUrl).host;
const csp = is.dev ? [
  `default-src 'self' ${devOrigin}`,
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${devOrigin}`,
  `connect-src ws://${devHost} ${devOrigin}`,
  ...
] : [...]
```

Il pattern `const __dirname = fileURLToPath(new URL(".", import.meta.url))` rimane invariato — electron-vite emette ESM per il main process.

---

## Dettaglio: struttura tsconfig

### `tsconfig.json` (base condivisa)

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

### `tsconfig.node.json` (main + preload)

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

### `tsconfig.web.json` (renderer — nuovo)

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

---

## Dettaglio: `electron-builder.yml`

Solo le directory di output cambiano. Tutte le esclusioni e le regole `asarUnpack` restano invariate.

```yaml
files:
  - out/main/**/*       # era: dist/main/**/*
  - out/preload/**/*    # nuovo (preload ora ha directory separata)
  - out/renderer/**/*   # era: dist/renderer/**/*
  - package.json
  - node_modules/**/*
  # ... esclusioni invariate
```

`dist/shared` scompare: electron-vite bundle il codice shared direttamente in `out/main/main.js`, non emette una directory separata.

---

## Riepilogo impatto

| Categoria | Conteggio |
|-----------|-----------|
| File nuovi | 3 |
| File modificati | 6 |
| File eliminati | 2 |
| Moduli aggiunti | 3 (`electron-vite`, `@electron-toolkit/utils`, `@electron-toolkit/preload`) |
| Moduli rimossi | 2 (`concurrently`, `wait-on`) |
| Logica di business modificata | 0 |
| IPC channels modificati | 0 |
| Componenti React modificati | 0 |
