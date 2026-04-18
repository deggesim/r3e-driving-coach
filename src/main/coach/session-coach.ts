/**
 * SessionCoachEngine — on-demand session analysis.
 *
 * Loads all laps, setups and prior analyses for a session from SQLite,
 * builds a session-level prompt, streams Claude response, persists a new
 * session_analyses_<game> row with incremental version.
 */

import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import {
  SESSION_SYSTEM_PROMPT,
  buildSessionPrompt,
} from "./prompt-builder.js";
import type {
  GameSource,
  LapRow,
  SessionAnalysisRow,
  SessionRow,
  SessionSetupRow,
  SetupData,
} from "../../shared/types.js";

type SessionCoachOptions = {
  db: Database.Database;
  apiKey?: string;
  model?: string;
  onChunk?: (data: {
    sessionId: number;
    version: number;
    token: string;
  }) => void;
  onDone?: (data: {
    sessionId: number;
    analysis: SessionAnalysisRow;
  }) => void;
};

export type SessionCoachEngine = {
  updateApiKey: (apiKey: string) => void;
  updateCornerNames: (names: Map<number, string>) => void;
  analyzeSession: (
    sessionId: number,
    game: GameSource,
    resolved?: { carName?: string; trackName?: string; layoutName?: string },
  ) => Promise<SessionAnalysisRow | null>;
};

const extractSection5 = (text: string): string => {
  const match = text.match(/\[5\][^\n]*\n([\s\S]*?)(?:\[6\]|$)/);
  if (!match) return "";
  const raw = match[1].trim();
  const stripped = raw
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
  const sentences = stripped.match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences.slice(0, 3).join(" ").trim();
};

const tableFor = (game: GameSource, base: string): string =>
  `${base}_${game === "ace" ? "ace" : "r3e"}`;

export const createSessionCoachEngine = (
  options: SessionCoachOptions,
): SessionCoachEngine => {
  const db = options.db;
  const model = options.model ?? "claude-haiku-4-5-20251001";
  let client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });
  let cornerNames = new Map<number, string>();

  return {
    updateApiKey: (apiKey) => {
      client = new Anthropic({ apiKey });
    },
    updateCornerNames: (names) => {
      cornerNames = names;
    },

    analyzeSession: async (sessionId, game, resolved) => {
      const sessionsTable = tableFor(game, "sessions");
      const lapsTable = tableFor(game, "laps");
      const setupsTable = tableFor(game, "session_setups");
      const analysesTable = tableFor(game, "session_analyses");

      const sessionRow = db
        .prepare(`SELECT * FROM ${sessionsTable} WHERE id = ?`)
        .get(sessionId) as (Omit<SessionRow, "game"> & Record<string, unknown>) | undefined;
      if (!sessionRow) return null;

      const session: SessionRow = {
        id: sessionRow.id as number,
        game,
        car: sessionRow.car as string,
        track: sessionRow.track as string,
        layout: sessionRow.layout as string,
        session_type: sessionRow.session_type as string,
        started_at: sessionRow.started_at as string,
        ended_at: (sessionRow.ended_at as string | null) ?? null,
        best_lap: (sessionRow.best_lap as number | null) ?? null,
        lap_count: sessionRow.lap_count as number,
      };

      const laps = db
        .prepare(
          `SELECT * FROM ${lapsTable} WHERE session_id = ? ORDER BY lap_number ASC`,
        )
        .all(sessionId) as LapRow[];

      const setupRowsRaw = db
        .prepare(
          `SELECT * FROM ${setupsTable} WHERE session_id = ? ORDER BY loaded_at ASC, id ASC`,
        )
        .all(sessionId) as Array<{
        id: number;
        session_id: number;
        loaded_at: string;
        setup_json: string;
        setup_screenshots: string | null;
      }>;

      const setups: SessionSetupRow[] = setupRowsRaw.map((r) => {
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

      const priorAnalyses = db
        .prepare(
          `SELECT * FROM ${analysesTable} WHERE session_id = ? ORDER BY version ASC`,
        )
        .all(sessionId) as SessionAnalysisRow[];

      const prompt = buildSessionPrompt({
        session,
        laps,
        setups,
        priorAnalyses,
        cornerNames,
        carName: resolved?.carName,
        trackName: resolved?.trackName,
        layoutName: resolved?.layoutName,
      });

      const nextVersion = (priorAnalyses.at(-1)?.version ?? 0) + 1;

      let fullText = "";
      try {
        const stream = client.messages.stream({
          model,
          max_tokens: 4000,
          system: SESSION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            options.onChunk?.({
              sessionId,
              version: nextVersion,
              token: event.delta.text,
            });
          }
        }

        await stream.finalMessage();
      } catch (err) {
        console.error("[SessionCoach] Claude API error:", err);
        return null;
      }

      const section5 = extractSection5(fullText);
      const createdAt = new Date().toISOString();

      const result = db
        .prepare(
          `INSERT INTO ${analysesTable} (session_id, version, template_v3, section5_summary, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(sessionId, nextVersion, fullText, section5, createdAt);

      const analysis: SessionAnalysisRow = {
        id: Number(result.lastInsertRowid),
        session_id: sessionId,
        version: nextVersion,
        template_v3: fullText,
        section5_summary: section5,
        created_at: createdAt,
      };

      options.onDone?.({ sessionId, analysis });
      return analysis;
    },
  };
};
