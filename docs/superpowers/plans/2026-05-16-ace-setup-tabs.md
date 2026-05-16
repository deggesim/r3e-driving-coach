# ACE Setup Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire la tabella piatta del setup ACE in `SetupDetailModal` con un componente a tab `AceSetupTabs` che replica la struttura del gioco (Pneumatici, Elettronica, Carburante e Strategia, Sospensioni, Ammortizzatori, Aerodinamica) con layout 4-corner per i parametri per-ruota.

**Architecture:** Nuovo componente `AceSetupTabs.tsx` standalone che riceve `params: SetupParam[]` e li raggruppa per tab tramite routing sulle categorie prodotte da `ace-setup-reader.ts`. Il componente `FourCornerGrid` è riusabile internamente per i tab Pneumatici, Sospensioni e Ammortizzatori. `SetupDetailModal` sostituisce il branch `game === "ace"` con il nuovo componente.

**Tech Stack:** React 18, TypeScript strict, react-bootstrap Nav/tabs, classi CSS esistenti in `global.css`

---

## File Map

| Azione | File |
|---|---|
| **Crea** | `src/renderer/components/AceSetupTabs.tsx` |
| **Modifica** | `src/renderer/components/SetupDetailModal.tsx` |

---

### Task 1: Creare `AceSetupTabs.tsx` — utility functions

**Files:**
- Create: `src/renderer/components/AceSetupTabs.tsx`

- [ ] **Step 1: Crea il file con le utility functions**

Crea `src/renderer/components/AceSetupTabs.tsx` con questo contenuto:

```tsx
import { useState } from "react";
import { Nav } from "react-bootstrap";
import type { SetupParam } from "../../shared/types";

const ACE_TAB_ORDER = [
  "Pneumatici",
  "Elettronica",
  "Carburante e Strategia",
  "Sospensioni",
  "Ammortizzatori",
  "Aerodinamica",
] as const;
type AceTabId = (typeof ACE_TAB_ORDER)[number];

const WHEEL_KEYS = ["FL", "FR", "RL", "RR"] as const;
type WheelKey = (typeof WHEEL_KEYS)[number];

const WHEEL_LABELS: Record<WheelKey, string> = {
  FL: "Ant. Sinistro",
  FR: "Ant. Destro",
  RL: "Post. Sinistro",
  RR: "Post. Destro",
};

function getAceTab(p: SetupParam): AceTabId {
  switch (p.category) {
    case "Pneumatici":
    case "Geometria":
      return "Pneumatici";
    case "Elettronica":
      return "Elettronica";
    case "Carburante":
    case "Identificazione":
      return "Carburante e Strategia";
    case "Sospensioni":
    case "Sterzo":
    case "Freni":
      return "Sospensioni";
    case "Ammortizzatori":
      return "Ammortizzatori";
    case "Aerodinamica":
    case "Assetto":
      return "Aerodinamica";
    default:
      return "Aerodinamica";
  }
}

function getWheelKey(parameter: string): WheelKey | null {
  for (const key of WHEEL_KEYS) {
    if (new RegExp(`\\s${key}(\\s|$)`).test(parameter)) return key;
  }
  return null;
}

function stripWheelSuffix(parameter: string): string {
  return parameter.replace(/\s+(FL|FR|RL|RR)(?=\s|$)/, "").trim();
}
```

- [ ] **Step 2: Verifica che TypeScript compili senza errori**

```powershell
cd D:\Progetti\sim-driving-coach
npx tsc --noEmit 2>&1 | Select-String "AceSetupTabs"
```

Output atteso: nessuna riga (nessun errore su questo file).

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/components/AceSetupTabs.tsx
git commit -m "feat: add AceSetupTabs utility functions and tab mapping"
```

---

### Task 2: Aggiungere `ParamTable` e `FourCornerGrid`

**Files:**
- Modify: `src/renderer/components/AceSetupTabs.tsx`

- [ ] **Step 1: Aggiungi i componenti dopo le utility functions**

Appendi in fondo al file (prima dell'`export default` che ancora non c'è):

```tsx
function ParamTable({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <table className="setup-tab-table w-100">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="text-muted">{r.label}</td>
            <td className="setup-value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FourCornerGrid({ params }: { params: SetupParam[] }) {
  const byWheel: Partial<Record<WheelKey, SetupParam[]>> = {};
  const shared: SetupParam[] = [];

  for (const p of params) {
    const key = getWheelKey(p.parameter);
    if (key) {
      if (!byWheel[key]) byWheel[key] = [];
      byWheel[key]!.push(p);
    } else {
      shared.push(p);
    }
  }

  const rows: [WheelKey, WheelKey][] = [
    ["FL", "FR"],
    ["RL", "RR"],
  ];

  return (
    <div>
      {rows.map(([left, right]) => (
        <div key={left} className="d-flex gap-2 mb-2">
          {([left, right] as WheelKey[]).map((key) => (
            <div key={key} className="setup-axle-col">
              <div className="setup-subsection-title">{WHEEL_LABELS[key]}</div>
              <ParamTable
                rows={(byWheel[key] ?? []).map((p) => ({
                  label: stripWheelSuffix(p.parameter),
                  value: p.value,
                }))}
              />
            </div>
          ))}
        </div>
      ))}
      {shared.length > 0 && (
        <ParamTable
          rows={shared.map((p) => ({ label: p.parameter, value: p.value }))}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verifica compilazione**

```powershell
npx tsc --noEmit 2>&1 | Select-String "AceSetupTabs"
```

Output atteso: nessuna riga.

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/components/AceSetupTabs.tsx
git commit -m "feat: add ParamTable and FourCornerGrid components"
```

---

### Task 3: Aggiungere `SuspensionTab` e il componente principale `AceSetupTabs`

**Files:**
- Modify: `src/renderer/components/AceSetupTabs.tsx`

- [ ] **Step 1: Aggiungi `SuspensionTab` e `AceSetupTabs`**

Appendi in fondo al file:

```tsx
function SuspensionTab({ params }: { params: SetupParam[] }) {
  const firstCornerIdx = params.findIndex((p) => getWheelKey(p.parameter) !== null);
  const lastCornerIdx = params.reduce(
    (acc, p, i) => (getWheelKey(p.parameter) !== null ? i : acc),
    -1,
  );

  const sharedTop =
    firstCornerIdx > 0 ? params.slice(0, firstCornerIdx) : [];
  const cornerBlock =
    firstCornerIdx >= 0
      ? params.slice(firstCornerIdx, lastCornerIdx + 1)
      : [];
  const sharedBottom =
    lastCornerIdx >= 0 && lastCornerIdx < params.length - 1
      ? params.slice(lastCornerIdx + 1)
      : [];

  return (
    <div>
      {sharedTop.length > 0 && (
        <div className="mb-2">
          <ParamTable
            rows={sharedTop.map((p) => ({ label: p.parameter, value: p.value }))}
          />
        </div>
      )}
      {cornerBlock.length > 0 && (
        <div className="mb-2">
          <FourCornerGrid params={cornerBlock} />
        </div>
      )}
      {sharedBottom.length > 0 && (
        <div className="mb-2">
          <ParamTable
            rows={sharedBottom.map((p) => ({
              label: p.parameter,
              value: p.value,
            }))}
          />
        </div>
      )}
    </div>
  );
}

const AceSetupTabs = ({ params }: { params: SetupParam[] }) => {
  const byTab: Partial<Record<AceTabId, SetupParam[]>> = {};
  for (const p of params) {
    const tab = getAceTab(p);
    if (!byTab[tab]) byTab[tab] = [];
    byTab[tab]!.push(p);
  }

  const available = ACE_TAB_ORDER.filter((t) => (byTab[t]?.length ?? 0) > 0);
  const [active, setActive] = useState<AceTabId>(
    () => available[0] ?? "Pneumatici",
  );

  if (available.length === 0) return null;

  const flatRows = (tab: AceTabId) =>
    (byTab[tab] ?? []).map((p) => ({ label: p.parameter, value: p.value }));

  return (
    <div>
      <Nav
        variant="tabs"
        className="setup-nav-tabs mb-2"
        activeKey={active}
        onSelect={(k) => k && setActive(k as AceTabId)}
      >
        {available.map((t) => (
          <Nav.Item key={t}>
            <Nav.Link eventKey={t}>{t}</Nav.Link>
          </Nav.Item>
        ))}
      </Nav>
      <div className="setup-tab-body">
        {active === "Pneumatici" && (
          <FourCornerGrid params={byTab["Pneumatici"] ?? []} />
        )}
        {active === "Elettronica" && (
          <ParamTable rows={flatRows("Elettronica")} />
        )}
        {active === "Carburante e Strategia" && (
          <ParamTable rows={flatRows("Carburante e Strategia")} />
        )}
        {active === "Sospensioni" && (
          <SuspensionTab params={byTab["Sospensioni"] ?? []} />
        )}
        {active === "Ammortizzatori" && (
          <FourCornerGrid params={byTab["Ammortizzatori"] ?? []} />
        )}
        {active === "Aerodinamica" && (
          <ParamTable rows={flatRows("Aerodinamica")} />
        )}
      </div>
    </div>
  );
};

export default AceSetupTabs;
```

- [ ] **Step 2: Verifica compilazione**

```powershell
npx tsc --noEmit 2>&1 | Select-String "AceSetupTabs"
```

Output atteso: nessuna riga.

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/components/AceSetupTabs.tsx
git commit -m "feat: add SuspensionTab and AceSetupTabs main component"
```

---

### Task 4: Aggiornare `SetupDetailModal` per usare `AceSetupTabs`

**Files:**
- Modify: `src/renderer/components/SetupDetailModal.tsx`

- [ ] **Step 1: Sostituisci il branch ACE nella modal**

In `src/renderer/components/SetupDetailModal.tsx`, aggiungi l'import e sostituisci il rendering ACE.

Aggiungi in cima agli import:

```tsx
import AceSetupTabs from "./AceSetupTabs";
```

Sostituisci il blocco ACE (attualmente righe 43–61 circa):

```tsx
// DA RIMUOVERE — tabella piatta ACE:
          game === "ace" ? (
            <table className="setup-table w-100">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Parametro</th>
                  <th>Valore</th>
                </tr>
              </thead>
              <tbody>
                {row.setup.params.map((p) => (
                  <tr key={`${p.category}__${p.parameter}`}>
                    <td className="text-muted">{p.category}</td>
                    <td>{p.parameter}</td>
                    <td className="setup-value">{p.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
```

```tsx
// DA METTERE AL POSTO:
          game === "ace" ? (
            <AceSetupTabs params={row.setup.params} />
          ) : (
```

- [ ] **Step 2: Verifica compilazione globale**

```powershell
npx tsc --noEmit 2>&1
```

Output atteso: nessun errore (zero righe di output).

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/components/SetupDetailModal.tsx
git commit -m "feat: use AceSetupTabs in SetupDetailModal for ACE setups"
```

---

### Task 5: Test visivo nel dev server

**Files:** nessuno (verifica)

- [ ] **Step 1: Avvia il dev server**

```powershell
npm run dev
```

- [ ] **Step 2: Apri un setup ACE in `SetupDetailModal`**

Vai in **Storico sessioni** → seleziona una sessione ACE → apri il dettaglio setup (pulsante "Dettaglio" o click sul badge setup). Oppure usa **Carica setup** nella sessione attiva e apri il preview tramite `SetupDetailModal`.

- [ ] **Step 3: Verifica tab Pneumatici**

Controlla che:
- I tab `Pneumatici`, `Elettronica`, `Carburante e Strategia`, `Sospensioni`, `Ammortizzatori`, `Aerodinamica` siano presenti (solo quelli con dati)
- Il tab **Pneumatici** mostra la griglia 2×2 con titoli `Ant. Sinistro`, `Ant. Destro`, `Post. Sinistro`, `Post. Destro`
- I label dei parametri non hanno il suffisso ruota (es. `Pressione (PSI)` non `Pressione FL (PSI)`)
- `Mescola` (senza suffisso ruota) appare come riga shared in fondo

- [ ] **Step 4: Verifica tab Sospensioni**

Controlla che:
- La sezione shared top mostri `Rapporto Sterzo`, `Ripartizione Freno Anteriore %`, `ARB Anteriore`
- La griglia 4-corner mostri le molle per ruota
- Se il setup ha ARB Posteriore o Precarico, appaiano in una sezione shared bottom dopo la griglia

- [ ] **Step 5: Verifica tab Ammortizzatori**

Controlla che la griglia 4-corner mostri `Lento Compressione` e `Lento Estensione` per ogni corner senza suffisso ruota nei label.

- [ ] **Step 6: Verifica tab Aerodinamica**

Controlla che `Altezza da Terra Anteriore`, `Altezza da Terra Posteriore`, `Ala Posteriore` (e ala anteriore se presente) siano in lista piatta.

- [ ] **Step 7: Commit finale se tutto ok**

```powershell
git add -A
git commit -m "chore: verify AceSetupTabs visual test passed"
```

Se il commit non ha file da aggiungere (step precedenti già committati), il messaggio è opzionale — il test è sufficiente.
