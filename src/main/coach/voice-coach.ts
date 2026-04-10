/**
 * VoiceCoach — handles free-form voice questions about the current driving session.
 *
 * Builds session context from SQLite (last laps, zones, deviations, corner names),
 * then streams a Claude response in Italian.
 */

import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import type { Deviation, LapRow } from "../../shared/types";

const VOICE_SYSTEM_PROMPT = `Sei un coach di guida esperto che risponde a domande specifiche di un pilota durante una sessione di guida.
Rispondi SEMPRE in italiano, in modo conciso e diretto. Massimo 3-4 frasi.
Il pilota sta guidando in questo momento — sii pratico, usa dati numerici, cita le curve per nome quando disponibile.
Non ripetere la domanda. Non usare elenchi puntati. Rispondi come se stessi parlando al pilota in diretta radio.`;

type SessionContext = {
  car: string;
  track: string;
  layout: string;
  laps: LapRow[];
  lastLapZones: string | null;
  deviations: Deviation[] | null;
  cornerMap: Map<number, string>;
};

const formatLapTime = (seconds: number): string => {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0
    ? `${mins}:${secs.toFixed(3).padStart(6, "0")}`
    : `${secs.toFixed(3)}s`;
};

/**
 * Build a compact context string for the voice query prompt.
 */
const buildVoiceContext = (ctx: SessionContext): string => {
  const parts: string[] = [];

  parts.push(`## Sessione corrente`);
  parts.push(`- Auto: ${ctx.car}`);
  parts.push(`- Circuito: ${ctx.track} (${ctx.layout})`);
  parts.push(`- Numero giri completati: ${ctx.laps.length}`);

  if (ctx.laps.length > 0) {
    const best = ctx.laps.reduce((a, b) =>
      (a.lap_time ?? Infinity) < (b.lap_time ?? Infinity) ? a : b,
    );
    parts.push(
      `- Miglior tempo: ${formatLapTime(best.lap_time)} (Giro ${best.lap_number})`,
    );

    const recent = ctx.laps.slice(0, 5);
    parts.push(`\n## Ultimi giri (dal più recente)`);
    for (const lap of recent) {
      const s1 = lap.sector1 ? formatLapTime(lap.sector1) : "--";
      const s2 = lap.sector2 ? formatLapTime(lap.sector2) : "--";
      const s3 = lap.sector3 ? formatLapTime(lap.sector3) : "--";
      parts.push(
        `- Giro ${lap.lap_number}: ${formatLapTime(lap.lap_time)} [S1:${s1} S2:${s2} S3:${s3}] ${lap.valid ? "✓" : "✗ invalido"}`,
      );
    }
  }

  // Corner names available on this track
  if (ctx.cornerMap.size > 0) {
    const cornerList = Array.from(ctx.cornerMap.entries())
      .map(([zone, name]) => `@${zone * 50}m → ${name}`)
      .join(", ");
    parts.push(`\n## Curve del circuito\n${cornerList}`);
  }

  // Last lap zone data (speed/brake/throttle per zone)
  if (ctx.lastLapZones) {
    try {
      const zones = JSON.parse(ctx.lastLapZones) as Array<{
        zone: number;
        dist: number;
        avgSpeedKmh: number;
        minSpeedKmh: number;
        maxBrakePct: number;
        avgThrottlePct: number;
        tcActivations: number;
        absActivations: number;
      }>;

      const significant = zones.filter(
        (z) => z.maxBrakePct > 0.2 || z.avgThrottlePct < 0.5,
      );

      if (significant.length > 0) {
        parts.push(
          `\n## Zone telemetria ultimo giro (zone con frenata o scarsa accelerazione)`,
        );
        for (const z of significant.slice(0, 20)) {
          const cornerName = ctx.cornerMap.get(z.zone);
          const label = cornerName ? ` [${cornerName}]` : "";
          parts.push(
            `- @${z.dist}m${label}: min ${z.minSpeedKmh.toFixed(0)}km/h, freno ${(z.maxBrakePct * 100).toFixed(0)}%, gas ${(z.avgThrottlePct * 100).toFixed(0)}%, ABS:${z.absActivations} TC:${z.tcActivations}`,
          );
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  // Deviations from baseline
  if (ctx.deviations && ctx.deviations.length > 0) {
    parts.push(`\n## Deviazioni rilevate rispetto alla baseline`);
    for (const d of ctx.deviations) {
      const cornerName = ctx.cornerMap.get(Math.floor(d.dist / 50));
      const label = cornerName ? ` [${cornerName}]` : "";
      parts.push(`- ${d.type} @${d.dist}m${label}: ${d.message}`);
    }
  }

  return parts.join("\n");
};

export type VoiceCoachEngine = {
  handleVoiceQuery: (
    question: string,
    onChunk: (token: string) => void,
  ) => Promise<string>;
  updateContext: (ctx: Partial<SessionContext>) => void;
};

export const createVoiceCoachEngine = (
  db: Database.Database,
  apiKey: string,
): VoiceCoachEngine => {
  const client = new Anthropic({ apiKey });
  const currentContext: SessionContext = {
    car: "Sconosciuta",
    track: "Sconosciuto",
    layout: "",
    laps: [],
    lastLapZones: null,
    deviations: null,
    cornerMap: new Map(),
  };

  /**
   * Refresh laps from DB for the current car/track.
   */
  const refreshLaps = (): void => {
    if (currentContext.car === "Sconosciuta") return;
    try {
      const rows = db
        .prepare(
          `SELECT l.* FROM laps l
           JOIN sessions s ON l.session_id = s.id
           WHERE s.car = ? AND s.track = ?
           ORDER BY l.recorded_at DESC LIMIT 10`,
        )
        .all(currentContext.car, currentContext.track) as LapRow[];
      currentContext.laps = rows;
    } catch {
      // DB not ready yet
    }
  };

  return {
    updateContext: (ctx) => {
      if (ctx.car !== undefined) currentContext.car = ctx.car;
      if (ctx.track !== undefined) currentContext.track = ctx.track;
      if (ctx.layout !== undefined) currentContext.layout = ctx.layout;
      if (ctx.lastLapZones !== undefined)
        currentContext.lastLapZones = ctx.lastLapZones;
      if (ctx.deviations !== undefined)
        currentContext.deviations = ctx.deviations;
      if (ctx.cornerMap !== undefined) currentContext.cornerMap = ctx.cornerMap;
      if (ctx.laps !== undefined) currentContext.laps = ctx.laps;

      // Always refresh laps from DB on car/track update
      if (ctx.car !== undefined || ctx.track !== undefined) refreshLaps();
    },

    handleVoiceQuery: async (question, onChunk) => {
      // Refresh laps before building context
      refreshLaps();

      const contextText = buildVoiceContext(currentContext);
      const userMessage = `${contextText}\n\n---\n\n## Domanda del pilota\n${question}`;

      let fullText = "";

      const stream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: VOICE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          fullText += event.delta.text;
          onChunk(event.delta.text);
        }
      }

      await stream.finalMessage();
      return fullText;
    },
  };
};
