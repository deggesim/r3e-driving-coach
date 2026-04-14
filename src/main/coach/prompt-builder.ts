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

import { BRAKE_TEMP } from "../../shared/alert-types";
import type { LapRecord, Deviation, ZoneData } from "../../shared/types";
import { formatLapTime } from "../../shared/format";

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
- Se le temperature freni sono -1, non sono disponibili per questa auto — ignora
- In Qualification/Leaderboard le temperature gomme sono fisse a 85°C — non diagnosticare come problema`;

/**
 * Build the user message for Claude API from lap data.
 */
export const buildPrompt = (
  lap: LapRecord,
  deviations: Deviation[] | null,
  cornerNames: Map<number, string>,
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
      parts.push(`- Frenata max: ${(zone.maxBrakePct * 100).toFixed(0)}%`);
      parts.push(
        `- Acceleratore medio: ${(zone.avgThrottlePct * 100).toFixed(0)}%`,
      );
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
const getSignificantZones = (
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
