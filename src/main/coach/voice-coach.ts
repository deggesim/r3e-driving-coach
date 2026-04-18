/**
 * VoiceCoach — handles free-form voice questions about the current driving session.
 *
 * Builds session context from SQLite (all laps, all setups, all prior analyses),
 * then streams Claude response in Italian.
 */

import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import type {
  Deviation,
  GameSource,
  LapRow,
  SessionAnalysisRow,
  SessionSetupRow,
  SetupData,
} from "../../shared/types.js";
import { formatLapTime } from "../../shared/format.js";

const VOICE_SYSTEM_PROMPT = `Sei un coach di guida esperto che risponde a domande specifiche di un pilota durante una sessione di guida.
Rispondi SEMPRE in italiano, in modo conciso e diretto. Massimo 3-4 frasi.
Il pilota sta guidando in questo momento — sii pratico, usa dati numerici, cita le curve per nome quando disponibile.
Non ripetere la domanda. Non usare elenchi puntati. Rispondi come se stessi parlando al pilota in diretta radio.`;

type SessionContext = {
  game: GameSource;
  car: string;
  track: string;
  layout: string;
  carName: string;
  trackName: string;
  layoutName: string;
  laps: LapRow[];
  lastLapZones: string | null;
  deviations: Deviation[] | null;
  cornerMap: Map<number, string>;
  setups: SessionSetupRow[];
  analyses: SessionAnalysisRow[];
};

const buildVoiceContext = (ctx: SessionContext): string => {
  const parts: string[] = [];

  parts.push(`## Sessione corrente`);
  parts.push(`- Auto: ${ctx.carName}`);
  parts.push(`- Circuito: ${ctx.trackName} (${ctx.layoutName})`);
  parts.push(`- Giri completati: ${ctx.laps.length}`);

  if (ctx.laps.length > 0) {
    const valid = ctx.laps.filter((l) => l.lap_time > 0);
    if (valid.length > 0) {
      const best = valid.reduce((a, b) => (a.lap_time < b.lap_time ? a : b));
      parts.push(
        `- Miglior tempo: ${formatLapTime(best.lap_time)} (Giro ${best.lap_number})`,
      );
    }

    const recent = ctx.laps.slice(-5).reverse();
    parts.push(`\n## Ultimi giri (dal più recente)`);
    for (const lap of recent) {
      const s1 = lap.sector1 != null ? formatLapTime(lap.sector1) : "--";
      const s2 = lap.sector2 != null ? formatLapTime(lap.sector2) : "--";
      const s3 = lap.sector3 != null ? formatLapTime(lap.sector3) : "--";
      parts.push(
        `- Giro ${lap.lap_number}: ${formatLapTime(lap.lap_time)} [S1:${s1} S2:${s2} S3:${s3}] ${lap.valid ? "✓" : "✗"}`,
      );
    }
  }

  if (ctx.cornerMap.size > 0) {
    const cornerList = Array.from(ctx.cornerMap.entries())
      .map(([zone, name]) => `@${zone * 50}m → ${name}`)
      .join(", ");
    parts.push(`\n## Curve del circuito\n${cornerList}`);
  }

  if (ctx.lastLapZones) {
    try {
      const zones = JSON.parse(ctx.lastLapZones) as Array<{
        zone: number;
        dist: number;
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
        parts.push(`\n## Telemetria ultimo giro (zone rilevanti)`);
        for (const z of significant.slice(0, 20)) {
          const cn = ctx.cornerMap.get(z.zone);
          const label = cn ? ` [${cn}]` : "";
          parts.push(
            `- @${z.dist}m${label}: min ${z.minSpeedKmh.toFixed(0)}km/h, freno ${(z.maxBrakePct * 100).toFixed(0)}%, gas ${(z.avgThrottlePct * 100).toFixed(0)}%, ABS:${z.absActivations} TC:${z.tcActivations}`,
          );
        }
      }
    } catch {
      // ignore
    }
  }

  if (ctx.deviations && ctx.deviations.length > 0) {
    parts.push(`\n## Deviazioni rispetto alla baseline`);
    for (const d of ctx.deviations) {
      const cn = ctx.cornerMap.get(Math.floor(d.dist / 50));
      const label = cn ? ` [${cn}]` : "";
      parts.push(`- ${d.type} @${d.dist}m${label}: ${d.message}`);
    }
  }

  if (ctx.setups.length > 0) {
    parts.push(`\n## Setup caricati in sessione (${ctx.setups.length})`);
    ctx.setups.forEach((s, idx) => {
      parts.push(
        `### Setup #${idx + 1} (${s.loaded_at}) — ${s.setup.carFound}`,
      );
      for (const p of s.setup.params.slice(0, 30)) {
        parts.push(`- ${p.category} / ${p.parameter}: ${p.value}`);
      }
    });
  }

  if (ctx.analyses.length > 0) {
    parts.push(`\n## Analisi precedenti della sessione`);
    for (const a of ctx.analyses) {
      parts.push(`### Analisi #${a.version} (${a.created_at})`);
      if (a.section5_summary) parts.push(a.section5_summary);
      else parts.push(a.template_v3.slice(0, 600));
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

const t = (base: string, game: GameSource): string =>
  `${base}_${game === "ace" ? "ace" : "r3e"}`;

export const createVoiceCoachEngine = (
  db: Database.Database,
  apiKey: string,
): VoiceCoachEngine => {
  const client = new Anthropic({ apiKey });
  const currentContext: SessionContext = {
    game: "r3e",
    car: "",
    track: "",
    layout: "",
    carName: "Sconosciuta",
    trackName: "Sconosciuto",
    layoutName: "",
    laps: [],
    lastLapZones: null,
    deviations: null,
    cornerMap: new Map(),
    setups: [],
    analyses: [],
  };

  /**
   * Refresh setups + analyses for the current open session (if any).
   * Laps are expected to be provided via updateContext from main.ts.
   */
  const refreshSession = (): void => {
    if (!currentContext.car || !currentContext.track) return;
    try {
      // Find the most recent open session for the current car/track
      const sessionRow = db
        .prepare(
          `SELECT id FROM ${t("sessions", currentContext.game)}
           WHERE car = ? AND track = ?
           ORDER BY started_at DESC LIMIT 1`,
        )
        .get(currentContext.car, currentContext.track) as
        | { id: number }
        | undefined;
      if (!sessionRow) return;

      const setupsRaw = db
        .prepare(
          `SELECT * FROM ${t("session_setups", currentContext.game)}
           WHERE session_id = ? ORDER BY loaded_at ASC, id ASC`,
        )
        .all(sessionRow.id) as Array<{
        id: number;
        session_id: number;
        loaded_at: string;
        setup_json: string;
        setup_screenshots: string | null;
      }>;
      currentContext.setups = setupsRaw.map((r) => {
        let setup: SetupData;
        try {
          setup = JSON.parse(r.setup_json) as SetupData;
        } catch {
          setup = {
            carVerified: false,
            carFound: "",
            setupText: "",
            params: [],
            screenshots: [],
          };
        }
        return {
          id: r.id,
          session_id: r.session_id,
          loaded_at: r.loaded_at,
          setup,
          setup_screenshots: r.setup_screenshots,
        };
      });

      currentContext.analyses = db
        .prepare(
          `SELECT * FROM ${t("session_analyses", currentContext.game)}
           WHERE session_id = ? ORDER BY version ASC`,
        )
        .all(sessionRow.id) as SessionAnalysisRow[];
    } catch {
      // DB not ready or table missing
    }
  };

  return {
    updateContext: (ctx) => {
      if (ctx.game !== undefined) currentContext.game = ctx.game;
      if (ctx.car !== undefined) currentContext.car = ctx.car;
      if (ctx.track !== undefined) currentContext.track = ctx.track;
      if (ctx.layout !== undefined) currentContext.layout = ctx.layout;
      if (ctx.carName !== undefined) currentContext.carName = ctx.carName;
      if (ctx.trackName !== undefined) currentContext.trackName = ctx.trackName;
      if (ctx.layoutName !== undefined) currentContext.layoutName = ctx.layoutName;
      if (ctx.lastLapZones !== undefined) currentContext.lastLapZones = ctx.lastLapZones;
      if (ctx.deviations !== undefined) currentContext.deviations = ctx.deviations;
      if (ctx.cornerMap !== undefined) currentContext.cornerMap = ctx.cornerMap;
      if (ctx.laps !== undefined) currentContext.laps = ctx.laps;
      if (ctx.setups !== undefined) currentContext.setups = ctx.setups;
      if (ctx.analyses !== undefined) currentContext.analyses = ctx.analyses;
    },

    handleVoiceQuery: async (question, onChunk) => {
      refreshSession();
      const contextText = buildVoiceContext(currentContext);
      const userMessage = `${contextText}\n\n---\n\n## Domanda del pilota\n${question}`;

      let fullText = "";
      const stream = client.messages.stream({
        model: "claude-haiku-4-5-20251001",
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
