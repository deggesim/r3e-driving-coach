# ACE Setup Tabs — Design Spec

**Data:** 2026-05-16
**Scope:** Visualizzazione setup ACE a tab, analoga a R3eSetupTabs

## Contesto

Il display del setup per ACE in `SetupDetailModal` è attualmente una tabella piatta a 3 colonne (categoria / parametro / valore). L'obiettivo è replicare la struttura a tab del gioco (Pneumatici, Elettronica, Carburante e Strategia, Sospensioni, Ammortizzatori, Aerodinamica), con layout a 4-corner per i parametri per-ruota.

## Approccio scelto

**Nuovo componente `AceSetupTabs.tsx` dedicato** (Approccio A). Logica ACE isolata in un file separato, speculare a `R3eSetupTabs.tsx`. Nessuna modifica al componente R3E.

## Sezione 1 — Mapping categorie → tab

| Categoria (ace-setup-reader) | Tab |
|---|---|
| `Pneumatici` | Pneumatici |
| `Geometria` | Pneumatici |
| `Elettronica` | Elettronica |
| `Carburante` | Carburante e Strategia |
| `Identificazione` | Carburante e Strategia |
| `Sospensioni` | Sospensioni |
| `Sterzo` | Sospensioni |
| `Freni` | Sospensioni |
| `Ammortizzatori` | Ammortizzatori |
| `Aerodinamica` | Aerodinamica |
| `Assetto` | Aerodinamica |

I tab vengono mostrati solo se contengono almeno un parametro.

## Sezione 2 — Layout per tab

### Pneumatici

Griglia 4-corner (2×2):

```
┌──────────────────┬──────────────────┐
│ Ant. Sinistro    │ Ant. Destro      │
│ Pressione (PSI)  │ Pressione (PSI)  │
│ Campanatura (°)  │ Campanatura (°)  │
│ Convergenza (°)  │ Convergenza (°)  │
├──────────────────┼──────────────────┤
│ Post. Sinistro   │ Post. Destro     │
│ Pressione (PSI)  │ Pressione (PSI)  │
│ Campanatura (°)  │ Campanatura (°)  │
└──────────────────┴──────────────────┘
Mescola: Slick (S)   ← riga shared in fondo
```

Tutti i parametri con suffisso `FL`/`FR`/`RL`/`RR` vanno nella cella corrispondente. I parametri senza suffisso (es. `Mescola`) appaiono come riga shared in fondo alla griglia.

Mapping wheel → label italiano:
- `FL` → `Ant. Sinistro`
- `FR` → `Ant. Destro`
- `RL` → `Post. Sinistro`
- `RR` → `Post. Destro`

### Elettronica

Lista piatta (nessuna sotto-sezione): TC1, ABS, Registrazione Telemetria e qualsiasi futuro parametro della categoria `Elettronica`.

### Carburante e Strategia

Lista piatta: Carburante (litri), Preset ID (se presente). Qualsiasi parametro futuro dalle categorie `Carburante` e `Identificazione`.

### Sospensioni

Layout a 3 zone nell'ordine di apparizione nel `params[]`:

1. **Shared top** — params senza suffisso ruota che precedono il primo param con suffisso (es. Rapporto Sterzo, Ripartizione Freno Anteriore, ARB Anteriore)
2. **Griglia 4-corner** — params con suffisso FL/FR/RL/RR (es. Molla FL/FR/RL/RR N/m)
3. **Shared bottom** — params senza suffisso ruota che seguono l'ultimo param con suffisso (es. ARB Posteriore, Precarico differenziale)

### Ammortizzatori

Griglia 4-corner. Ogni cella mostra **tutti** i params di quel corner senza filtraggio per tipo (lento compressione, lento estensione, veloce compressione, veloce estensione, ecc.).

### Aerodinamica

Lista piatta di tutti i parametri dalle categorie `Aerodinamica` e `Assetto` (ala anteriore, ala posteriore, altezze da terra, ecc.). Nessun filtraggio hard-coded.

## Sezione 3 — Struttura componente e file coinvolti

### Nuovo file: `src/renderer/components/AceSetupTabs.tsx`

Elementi interni:

- `ACE_TAB_ORDER` — array dei tab nell'ordine del gioco
- `getAceTab(p: SetupParam): AceTabId` — routing categoria → tab
- `getWheelKey(parameter: string): 'FL'|'FR'|'RL'|'RR'|null` — estrae il suffisso ruota
- `stripWheelSuffix(parameter: string): string` — rimuove ` FL`/` FR`/` RL`/` RR`
- `FourCornerGrid` — componente riusabile: raggruppa i params per wheel-key, renderizza griglia 2×2 con titoli corner e tabelle param/valore
- `SuspensionTab` — implementa la logica shared-top / 4-corner / shared-bottom
- `ParamTable` — tabella param/valore (come in R3eSetupTabs, duplicazione minima accettabile)
- `AceSetupTabs` (export default) — raggruppa per tab, Nav Bootstrap, renderizza body per tab attivo

### File modificato: `src/renderer/components/SetupDetailModal.tsx`

- Aggiunge `import AceSetupTabs from './AceSetupTabs'`
- Sostituisce il blocco `game === "ace"` (tabella piatta 3 colonne) con `<AceSetupTabs params={row.setup.params} />`

### CSS

Nessuna aggiunta. Classi esistenti in `global.css` già sufficienti:
`setup-tab-table`, `setup-subsection-title`, `setup-axle-col`, `setup-nav-tabs`, `setup-tab-body`

## Vincoli e note

- I tab vuoti non vengono mostrati (identico a R3eSetupTabs)
- Il componente è puramente presentazionale: riceve `params: SetupParam[]` e non fa IPC
- Nessuna modifica a `ace-setup-reader.ts` o ai tipi in `shared/types.ts`
- Le categorie future del reader appariranno automaticamente come lista piatta nel tab corretto se il mapping viene aggiornato, oppure verranno ignorate se la categoria non è mappata
