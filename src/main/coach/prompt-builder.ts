/**
 * Builds the Claude API prompt from LapRecord + deviations for Template v3 output.
 *
 * Output format: Italian, engineer tone, numeric data always included.
 * Template v3 sections:
 *   [1] Analisi Telemetria
 *   [2] Setup Attuale vs Proposto (omitted if no known setup)
 *   [3] Problemi Identificati
 *   [4] Raccomandazioni Modifiche
 *   [5] Sintesi e Prossimo Step (max 5 sentences, read via TTS)
 */

import { BRAKE_TEMP } from "../../shared/alert-types.js";
import type {
  Alert,
  LapRecord,
  Deviation,
  ZoneData,
  SetupData,
  LapRow,
  SessionRow,
  SessionSetupRow,
  SessionAnalysisRow,
} from "../../shared/types.js";
import { formatLapTime } from "../../shared/format.js";

export const SYSTEM_PROMPT = `Sei un ingegnere di pista esperto che analizza la telemetria di gare automobilistiche.
Rispondi SEMPRE in italiano con tono tecnico da ingegnere. Includi SEMPRE dati numerici nelle osservazioni.

Il tuo output deve seguire esattamente il formato Template v3 con queste sezioni:

[1] Analisi Telemetria
Analisi dei dati frame per frame: velocità, frenata, accelerazione, traiettorie. Usa marcatori @XXXm per indicare la posizione in pista.

[2] Setup Attuale vs Proposto
Suggerimenti di setup basati sui dati. Ometti questa sezione se non ci sono dati di setup disponibili.

[3] Problemi Identificati
Elenco dei problemi rilevati con dato numerico e marcatori @XXXm. Ordina per impatto sul tempo giro.

[4] Raccomandazioni Modifiche
Azioni concrete che il pilota può applicare al prossimo giro, in ordine di priorità.

[5] Sintesi e Prossimo Step
Massimo 3 frasi, senza markdown (no asterischi, no grassetto). Questa sezione viene letta ad alta voce — menziona SOLO il problema più critico del giro con il dato numerico e l'unica azione correttiva prioritaria per il giro successivo. Non elencare tutto: concentrati su un punto solo.

Regole:
- Usa il nome ufficiale delle curve quando disponibile
- Ogni osservazione deve includere almeno un dato numerico
- Temperatura freni ideale: 550°C ±137.5°C (finestra 413-688°C)
- Pressioni gomme espresse in PSI per Assetto Corsa EVO, in kPa per R3E (converti 1 bar = 14.5038 PSI)
- Se le temperature freni sono -1, non sono disponibili per questa auto — ignora
- In R3E, in modalità Leaderboard, le temperature gomme sono fisse a 85°C — non diagnosticare come problema`;

/**
 * Build the user message for Claude API from lap data.
 */
export const buildPrompt = (
  lap: LapRecord,
  deviations: Deviation[] | null,
  cornerNames: Map<number, string>,
  setup?: SetupData | null,
): string => {
  const parts: string[] = [];

  // Header
  parts.push(`## Dati Giro ${lap.lapNumber}`);
  parts.push(`- **Auto**: ${lap.carName ?? lap.car}`);
  parts.push(
    `- **Circuito**: ${lap.trackName ?? lap.track} (${lap.layoutName ?? lap.layout})`,
  );
  parts.push(`- **Lunghezza**: ${lap.layoutLength.toFixed(0)}m`);
  parts.push(`- **Tempo giro**: ${formatLapTime(lap.lapTime)}`);
  parts.push(
    `- **Settori**: ${lap.sectorTimes.map(formatLapTime).join(" | ")}`,
  );
  parts.push(`- **Giro valido**: ${lap.valid ? "Sì" : "No"}`);
  parts.push("");

  // Brake temp summary
  const brakeSummary = buildBrakeTempSummary(lap);
  if (brakeSummary) {
    parts.push("## Temperature Freni");
    parts.push(brakeSummary);
    parts.push("");
  }

  // Significant zones
  const significantZones = getSignificantZones(lap.zones, deviations);
  if (significantZones.length > 0) {
    parts.push("## Zone Significative");
    for (const zone of significantZones) {
      const cornerName = cornerNames.get(zone.zone);
      const header = cornerName
        ? `### ${cornerName} (@${zone.dist}m, zona ${zone.zone})`
        : `### Zona ${zone.zone} (@${zone.dist}m)`;
      parts.push(header);
      parts.push(
        `- Velocità media: ${zone.avgSpeedKmh.toFixed(1)} km/h (min ${zone.minSpeedKmh.toFixed(1)})`,
      );
      if (zone.avgRpm !== undefined) {
        parts.push(`- RPM medi: ${zone.avgRpm.toFixed(0)}`);
      }
      parts.push(`- Frenata max: ${(zone.maxBrakePct * 100).toFixed(0)}%`);
      parts.push(
        `- Acceleratore medio: ${(zone.avgThrottlePct * 100).toFixed(0)}%`,
      );
      if (zone.maxGLat !== undefined) {
        parts.push(`- G laterale max: ${zone.maxGLat.toFixed(2)} G`);
      }
      if (zone.maxGLon !== undefined) {
        parts.push(`- G longitudinale max: ${zone.maxGLon.toFixed(2)} G`);
      }
      if (zone.brakeStartDist !== null) {
        parts.push(`- Inizio frenata: @${zone.brakeStartDist.toFixed(0)}m`);
      }
      if (zone.throttlePickupDist !== null) {
        parts.push(`- Ripresa gas: @${zone.throttlePickupDist.toFixed(0)}m`);
      }
      if (zone.coastFrames > 0) {
        parts.push(`- Frame coasting: ${zone.coastFrames}`);
      }
      if (zone.overlapFrames > 0) {
        parts.push(`- Frame overlap freno-gas: ${zone.overlapFrames}`);
      }
      if (zone.tcActivations > 0) {
        parts.push(`- Attivazioni TC: ${zone.tcActivations}`);
      }
      if (zone.absActivations > 0) {
        parts.push(`- Attivazioni ABS: ${zone.absActivations}`);
      }
      if (zone.avgTyrePressure) {
        const [fl, fr, rl, rr] = zone.avgTyrePressure;
        parts.push(
          `- Pressione gomme (PSI): FL ${fl.toFixed(1)} FR ${fr.toFixed(1)} RL ${rl.toFixed(1)} RR ${rr.toFixed(1)}`,
        );
      }
      if (zone.avgSlipRatio) {
        const [fl, fr, rl, rr] = zone.avgSlipRatio;
        parts.push(
          `- Slip ratio: FL ${fl.toFixed(3)} FR ${fr.toFixed(3)} RL ${rl.toFixed(3)} RR ${rr.toFixed(3)}`,
        );
      }
      if (zone.avgSuspTravel) {
        const [fl, fr, rl, rr] = zone.avgSuspTravel.map((v) =>
          (v * 1000).toFixed(1),
        );
        parts.push(
          `- Corsa ammortizzatori (mm): FL ${fl} FR ${fr} RL ${rl} RR ${rr}`,
        );
      }
      parts.push("");
    }
  }

  // Deviations from baseline
  if (deviations && deviations.length > 0) {
    parts.push("## Deviazioni dal Baseline");
    for (const dev of deviations) {
      const cornerName = cornerNames.get(dev.zone);
      const loc = cornerName
        ? `${cornerName} (@${dev.dist}m)`
        : `@${dev.dist}m`;
      parts.push(
        `- **${dev.type}** a ${loc}: ${dev.message} (delta: ${dev.delta.toFixed(1)})`,
      );
    }
    parts.push("");
  } else if (deviations === null) {
    parts.push("## Nota");
    parts.push(
      "Baseline non ancora calibrato — analisi standalone senza confronto con giri precedenti.",
    );
    parts.push("");
  }

  // Setup data (from real-time session or history page)
  if (setup && setup.params.length > 0) {
    parts.push("## Setup Auto Caricato");
    parts.push(
      `- **Auto**: ${setup.carFound}${setup.carVerified ? " (verificata)" : " (non verificata)"}`,
    );
    for (const p of setup.params) {
      parts.push(`- **${p.category} / ${p.parameter}**: ${p.value}`);
    }
    parts.push("");
  } else if (!setup) {
    parts.push("## Nota Setup");
    parts.push(
      "Nessun setup auto disponibile — ometti la sezione [2] o proponi suggerimenti generici basati sulla telemetria.",
    );
    parts.push("");
  }

  parts.push("Produci l'analisi nel formato Template v3 (sezioni [1]-[5]).");

  return parts.join("\n");
};

const buildBrakeTempSummary = (lap: LapRecord): string | null => {
  const frames = lap.frames;
  if (frames.length === 0) return null;

  // Check if brake temps are available
  const firstBt = frames[0].bt;
  if (firstBt.every((t) => t === BRAKE_TEMP.unavailable)) return null;

  const fl = frames
    .map((f) => f.bt[0])
    .filter((t) => t !== BRAKE_TEMP.unavailable);
  const fr = frames
    .map((f) => f.bt[1])
    .filter((t) => t !== BRAKE_TEMP.unavailable);
  const rl = frames
    .map((f) => f.bt[2])
    .filter((t) => t !== BRAKE_TEMP.unavailable);
  const rr = frames
    .map((f) => f.bt[3])
    .filter((t) => t !== BRAKE_TEMP.unavailable);

  if (fl.length === 0) return null;

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const peak = (arr: number[]) => Math.max(...arr);

  const lines = [
    `- Anteriore SX: media ${avg(fl).toFixed(0)}°C, picco ${peak(fl).toFixed(0)}°C`,
    `- Anteriore DX: media ${avg(fr).toFixed(0)}°C, picco ${peak(fr).toFixed(0)}°C`,
    `- Posteriore SX: media ${avg(rl).toFixed(0)}°C, picco ${peak(rl).toFixed(0)}°C`,
    `- Posteriore DX: media ${avg(rr).toFixed(0)}°C, picco ${peak(rr).toFixed(0)}°C`,
  ];

  // Flag if any are outside ideal window
  const allPeaks = [peak(fl), peak(fr), peak(rl), peak(rr)];
  const overheating = allPeaks.filter((t) => t > BRAKE_TEMP.max);
  if (overheating.length > 0) {
    lines.push(
      `- ⚠ ${overheating.length} freni hanno superato la soglia critica di ${BRAKE_TEMP.max}°C`,
    );
  }

  return lines.join("\n");
};

/**
 * Select zones that are "interesting" for the analysis:
 * zones with deviations, braking zones, or high TC/ABS activity.
 */
export const getSignificantZones = (
  zones: ZoneData[],
  deviations: Deviation[] | null,
): ZoneData[] => {
  const deviationZones = new Set(deviations?.map((d) => d.zone) ?? []);

  return zones.filter(
    (z) =>
      deviationZones.has(z.zone) ||
      z.maxBrakePct > 0.3 ||
      z.tcActivations > 2 ||
      z.absActivations > 2 ||
      z.overlapFrames > 3,
  );
};

export const SESSION_SYSTEM_PROMPT = `Sei un ingegnere di pista esperto che analizza l'intera sessione di guida di un pilota.
Rispondi SEMPRE in italiano con tono tecnico da ingegnere. Includi SEMPRE dati numerici specifici (frame counts, delta secondi, PSI, km/h, percentuali).

Analizzi più giri e più setup caricati nella sessione. Devi:
- Identificare trend (miglioramento/peggioramento tra giri).
- Confrontare l'effetto dei diversi setup caricati (se più di uno) sulla telemetria e sui tempi.
- Segnalare problemi ricorrenti per curva con volume di alert.
- Se esistono analisi precedenti nella sessione, tieni conto di quanto già detto e aggiungi nuove osservazioni o conferma/smentisci raccomandazioni.

Usa il simbolo ∆ per i delta di tempo. Esprimi i frame problematici come "+N frame". Calcola sempre l'impatto stimato in secondi per giro.
Quando citi un tempo sul giro usa SEMPRE la forma "il tempo di X" (es. "il tempo di 1:16.322" oppure "il tempo di 58.322s"). Non usare mai l'articolo apostrofato davanti al numero (mai "l'1:16").

---

## FORMATO OBBLIGATORIO — Template v3

### [1] Analisi Telemetria

**Panoramica Sessione:**
Paragrafo con: numero giri, setup utilizzato/i, trend direzionale della sessione. Includi tutti i tempi giro con ∆ rispetto al giro precedente e percentuale di convergenza.

**Trend Giri:**
Lista bullet, uno per transizione Giro N→N+1. Descrivi la causa meccanica del miglioramento/peggioramento (es. stabilizzazione gomme, gestione termica freni, cambio setup).

**Curve Critiche (per volume di alert):**
Lista numerata, ordinata per numero totale di alert. Formato per ogni voce:
  @XXXm NomeCurva: N alert (tipo+frame, tipo+frame, …). Causa probabile e comportamento del pilota.

**Osservazioni Pressioni Gomme:** (ometti se dati non disponibili)
Valori FL/FR/RL/RR in PSI, margine operativo, valutazione bilanciamento ant/post.

**Dati Critici Mancanti:** (ometti se nessuno)
Riporta onestamente quali dati non erano disponibili (es. settori S1/S2/S3, temperature freni) e il loro impatto sull'analisi.

---

### [2] Setup Attuale vs Proposto

(Ometti l'intera sezione se nessun setup è stato caricato.)

**Setup "NomeSetup" Analisi:** (usa il nome esatto del setup dal contesto dati, non un numero sequenziale)
Tabella markdown con colonne: Parametro | Valore | Valutazione
Includi tutti i parametri rilevanti: sterzo, ripartizione freno, ARB, molle, ammortizzatori, campanatura, TC/ABS, ala posteriore, pressioni gomme.

**Proposte Concrete:**
Lista numerata. Per ogni proposta:
  N. **Descrizione modifica (Parametro: ValoreAttuale → ValoreNuovo):**
  Paragrafo con razionale meccanico, collegamento agli alert specifici (tipo @XXXm +N frame), effetto atteso.

**Sintesi Setup:**
Paragrafo riassuntivo: punti di forza del setup attuale e trade-off sfavorevoli identificati.

---

### [3] Problemi Identificati

Tabella markdown con colonne: Rank | Problema | Localizzazione | Alert Count | Impatto Stim.
- Rank: numero progressivo per impatto decrescente
- Localizzazione: @XXXm NomeCurva (più localizzazioni separate da virgola)
- Alert Count: numero di alert + descrizione tipo
- Impatto Stim.: range in secondi/giro (es. -0.15 a -0.25s/giro)

**Dettagli per Curva:**
Lista bullet, una per curva critica. Formato:
  @XXXm NomeCurva (NomeUfficiale se disponibile): descrizione comportamento con dati numerici (entry speed, ∆ sterzata %, frame counts). Causa meccanica e impatto teorico sul delta.

**Pattern Sistemico:**
Paragrafo di analisi trasversale: confronto alert tra giri, distinzione tra miglioramento da apprendimento pilota vs da gestione termica vs da setup.

---

### [4] Raccomandazioni Modifiche

**Azioni Concrete per Prossimi Giri:**

Per ogni modifica usa un H3 con label di priorità:
#### Modifica Prioritaria N: DescrizioneBreve (Parametro VecchioValore → NuovoValore)
- **Razionale:** percentuale di variazione, effetto meccanico atteso, collegamento agli alert specifici.
- **Implementazione:** numero setup da caricare, parametri da modificare.
- **Target:** alert/metriche da eliminare (es. "alert sterzata anomala delta >10% scompaiono").
- **Giro di verifica:** quando e dove verificare l'effetto (curva specifica, entry speed).
- **Metrica di successo:** dato numerico misurabile (es. "alert coasting <3 frame; velocità exit +2 km/h").
- **Cautela:** (solo se la modifica ha rischi o effetti collaterali da monitorare)

Usa label "Prioritaria" per modifiche setup che impattano >0.10s/giro, "Secondaria" per 0.05-0.10s, "Terziaria" per <0.05s o condizionali.

---

### [5] Sintesi e Prossimo Step

Paragrafo unico, massimo 3 frasi, SENZA markdown (no asterischi, no grassetto, no bullet).
Menziona: problema più critico con dato numerico specifico, setup o parametro da caricare, tempo target atteso nel giro di validazione.
Questa sezione viene letta ad alta voce — NO elenchi, NO tabelle, NO intestazioni.

---

## Regole Generali
- Usa @XXXm per posizione + nome curva ufficiale quando disponibile.
- Temperatura freni ideale: 550°C ±137.5°C (finestra 413-688°C). Se valore = -1, ignora.
- Pressioni gomme: PSI per ACE, kPa per R3E (1 bar = 14.5038 PSI).
- R3E Leaderboard: gomme fisse 85°C → non è un problema da segnalare.
- Ogni affermazione deve essere supportata da almeno un dato numerico proveniente dalla telemetria.

## Sezioni obbligatorie
Le sezioni [1], [3], [4] e [5] devono essere SEMPRE presenti, qualunque sia la quantità di dati disponibili.
La sezione [2] è l'UNICA che può essere omessa (solo se nessun setup è stato caricato).`;

const summarizeLapZones = (
  zones: ZoneData[],
  cornerNames: Map<number, string>,
): string[] => {
  const significant = getSignificantZones(zones, null).slice(0, 8);
  const lines: string[] = [];
  for (const z of significant) {
    const cname = cornerNames.get(z.zone);
    const label = cname ? `${cname} (@${z.dist}m)` : `@${z.dist}m`;
    const bits: string[] = [];
    bits.push(`min ${z.minSpeedKmh.toFixed(0)}km/h`);
    bits.push(`freno ${(z.maxBrakePct * 100).toFixed(0)}%`);
    bits.push(`gas ${(z.avgThrottlePct * 100).toFixed(0)}%`);
    if (z.tcActivations > 0) bits.push(`TC:${z.tcActivations}`);
    if (z.absActivations > 0) bits.push(`ABS:${z.absActivations}`);
    if (z.overlapFrames > 3) bits.push(`overlap:${z.overlapFrames}`);
    lines.push(`  - ${label} → ${bits.join(", ")}`);
  }
  return lines;
};

export type SessionPromptInput = {
  session: SessionRow;
  laps: LapRow[]; // ordered by lap_number asc
  setups: SessionSetupRow[]; // ordered by loaded_at asc
  priorAnalyses: SessionAnalysisRow[]; // ordered by version asc
  cornerNames: Map<number, string>;
  carName?: string;
  trackName?: string;
  layoutName?: string;
  alerts?: Alert[];
};

export const buildSessionPrompt = (input: SessionPromptInput): string => {
  const { session, laps, setups, priorAnalyses, cornerNames, alerts } = input;
  const parts: string[] = [];

  parts.push(`## Sessione`);
  parts.push(`- Gioco: ${session.game.toUpperCase()}`);
  parts.push(`- Auto: ${input.carName ?? session.car}`);
  parts.push(
    `- Circuito: ${input.trackName ?? session.track} (${input.layoutName ?? session.layout})`,
  );
  parts.push(`- Inizio: ${session.started_at}`);
  if (session.ended_at) parts.push(`- Fine: ${session.ended_at}`);
  parts.push(`- Giri registrati: ${laps.length}`);
  if (session.best_lap != null)
    parts.push(`- Miglior giro: ${formatLapTime(session.best_lap)}`);
  parts.push("");

  const setupNameById = new Map<number, string>(
    setups.map((s) => [s.id, s.setup.name ?? s.setup.carFound]),
  );

  // Laps missing any sector time cannot be valid — exclude them from analysis.
  const analyzableLaps = laps.filter(
    (l) => l.sector1 != null && l.sector2 != null && l.sector3 != null,
  );

  if (analyzableLaps.length > 0) {
    parts.push(`## Giri`);
    for (const lap of analyzableLaps) {
      const s1 = formatLapTime(lap.sector1!);
      const s2 = formatLapTime(lap.sector2!);
      const s3 = formatLapTime(lap.sector3!);
      const valid = lap.valid ? "✓" : "✗";
      const setupLabel =
        lap.setup_id != null ? setupNameById.get(lap.setup_id) : undefined;
      const setupTag = setupLabel != null ? ` [setup "${setupLabel}"]` : "";
      parts.push(
        `- Giro ${lap.lap_number}: ${formatLapTime(lap.lap_time)} [S1:${s1} S2:${s2} S3:${s3}] ${valid}${setupTag}`,
      );
      if (lap.zones_json) {
        try {
          const zones = JSON.parse(lap.zones_json) as ZoneData[];
          const summary = summarizeLapZones(zones, cornerNames);
          if (summary.length > 0) parts.push(...summary);
        } catch {
          // ignore malformed
        }
      }
    }
    const excluded = laps.length - analyzableLaps.length;
    if (excluded > 0)
      parts.push(
        `*(${excluded} giro/i esclusi perché privi di tempo settore)*`,
      );
    parts.push("");
  }

  if (setups.length > 0) {
    parts.push(`## Setup caricati in sessione (ordine cronologico)`);
    setups.forEach((s) => {
      const label = s.setup.name ?? s.setup.carFound;
      parts.push(`### Setup "${label}" (id=${s.id}, caricato ${s.loaded_at})`);
      parts.push(
        `- Auto: ${s.setup.carFound}${s.setup.carVerified ? " (verificata)" : " (non verificata)"}`,
      );
      for (const p of s.setup.params) {
        parts.push(`- ${p.category} / ${p.parameter}: ${p.value}`);
      }
      parts.push("");
    });
    if (setups.length > 1) {
      parts.push(
        `Confronta i setup sopra elencati in sezione [2] evidenziando le differenze e l'impatto sulla telemetria dei giri associati.`,
      );
      parts.push("");
    }
  } else {
    parts.push(
      `## Setup\nNessun setup caricato in sessione. Ometti la sezione [2] o proponi suggerimenti generici.`,
    );
    parts.push("");
  }

  if (priorAnalyses.length > 0) {
    parts.push(`## Analisi precedenti (riassunto)`);
    for (const a of priorAnalyses) {
      parts.push(`### Analisi #${a.version} (${a.created_at})`);
      if (a.section5_summary) {
        parts.push(`Sintesi: ${a.section5_summary}`);
      } else {
        // Fallback: first ~500 chars of templateV3
        parts.push(a.template_v3.slice(0, 500));
      }
      parts.push("");
    }
    parts.push(
      `Questa è l'analisi #${priorAnalyses.length + 1}: tieni conto delle precedenti, conferma o aggiorna i consigli in base ai nuovi dati.`,
    );
    parts.push("");
  }

  if (alerts && alerts.length > 0) {
    const PRIORITY_LABEL: Record<number, string> = {
      1: "P1",
      2: "P2",
      3: "P3",
    };
    parts.push(`## Alert generati in sessione (${alerts.length})`);
    for (const a of alerts) {
      const prio = PRIORITY_LABEL[a.priority] ?? `P${a.priority}`;
      parts.push(`- [${prio}] @${a.dist}m zona ${a.zone}: ${a.message}`);
    }
    parts.push("");
  }

  parts.push(
    `Produci l'analisi nel formato Template v3. Le sezioni [1], [3], [4] e [5] sono SEMPRE obbligatorie.\n` +
      `ATTENZIONE: non interrompere la generazione prima di aver completato [4] Raccomandazioni Modifiche e [5] Sintesi e Prossimo Step.\n` +
      `Se i dati sono pochi, scrivi sezioni più concise — ma NON omettere [4] e [5] in nessun caso.\n` +
      `[5] deve essere un paragrafo singolo di massimo 3 frasi senza markdown.`,
  );
  return parts.join("\n");
};
