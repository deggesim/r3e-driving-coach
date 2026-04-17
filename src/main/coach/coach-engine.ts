/**
 * CoachEngine — calls Claude API per lap, saves analysis to SQLite, generates PDF.
 *
 * Uses claude-haiku-4-5-20251001 with streaming (as per project spec).
 * Emits the Template v3 analysis via the onAnalysis callback.
 */

import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { SYSTEM_PROMPT, buildPrompt } from "./prompt-builder.js";
import type { LapRecord, Deviation, LapAnalysis } from "../../shared/types.js";
import { generatePdfBuffer } from "../pdf-generator.js";

type CoachEngineOptions = {
  db: Database.Database;
  onAnalysis: (analysis: LapAnalysis) => void;
  apiKey?: string;
  model?: string;
};

export type CoachEngine = {
  updateCornerNames: (names: Map<number, string>) => void;
  updateApiKey: (apiKey: string) => void;
  analyzeLap: (lap: LapRecord, deviations: Deviation[] | null) => Promise<void>;
};

const extractSection5 = (text: string): string => {
  const match = text.match(/\[5\][^\n]*\n([\s\S]*?)(?:\[6\]|$)/);
  if (!match) return "";
  const raw = match[1].trim();
  // Strip markdown: bold/italic markers, headers, list bullets, inline code
  const stripped = raw
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
    .replace(/\*([^*]+)\*/g, "$1") // *italic*
    .replace(/__([^_]+)__/g, "$1") // __bold__
    .replace(/_([^_]+)_/g, "$1") // _italic_
    .replace(/^#{1,6}\s+/gm, "") // # headers
    .replace(/^[-*+]\s+/gm, "") // list bullets
    .replace(/`([^`]+)`/g, "$1"); // `code`
  const sentences = stripped.match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences.slice(0, 3).join(" ").trim();
};

export const createCoachEngine = (options: CoachEngineOptions): CoachEngine => {
  const db = options.db;
  const onAnalysis = options.onAnalysis;
  const model = options.model ?? "claude-haiku-4-5-20251001";
  let client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });
  let cornerNames = new Map<number, string>();

  const saveAnalysis = (lap: LapRecord, analysis: LapAnalysis): void => {
    try {
      const lapsTable = lap.game === "ace" ? "laps_ace" : "laps";
      const sessionsTable = lap.game === "ace" ? "sessions_ace" : "sessions_r3e";
      const result = db
        .prepare(
          `
        UPDATE ${lapsTable} SET analysis_json = ?
        WHERE session_id = (
          SELECT id FROM ${sessionsTable}
          WHERE car = ? AND track = ? AND layout = ?
          ORDER BY started_at DESC LIMIT 1
        ) AND lap_number = ?
      `,
        )
        .run(
          JSON.stringify(analysis),
          lap.car,
          lap.track,
          lap.layout,
          lap.lapNumber,
        );
      if (result.changes === 0) {
        console.warn(
          `[CoachEngine] saveAnalysis — 0 rows updated (lap not in DB?) ` +
            `car="${lap.car}" track="${lap.track}" layout="${lap.layout}" lap=${lap.lapNumber}`,
        );
      } else {
        console.log(
          `[CoachEngine] saveAnalysis — OK lap=${lap.lapNumber} changes=${result.changes}`,
        );
      }
    } catch (err) {
      console.error("[CoachEngine] DB save error:", err);
    }
  };

  const updatePdfPath = (lap: LapRecord, pdfPath: string): void => {
    try {
      const lapsTable = lap.game === "ace" ? "laps_ace" : "laps";
      const sessionsTable = lap.game === "ace" ? "sessions_ace" : "sessions_r3e";
      db.prepare(
        `
        UPDATE ${lapsTable} SET pdf_path = ?
        WHERE session_id = (
          SELECT id FROM ${sessionsTable}
          WHERE car = ? AND track = ? AND layout = ?
          ORDER BY started_at DESC LIMIT 1
        ) AND lap_number = ?
      `,
      ).run(pdfPath, lap.car, lap.track, lap.layout, lap.lapNumber);
    } catch {
      // Non-critical
    }
  };

  const generatePdf = async (
    lap: LapRecord,
    analysis: LapAnalysis,
  ): Promise<string | null> => {
    try {
      const path = await import("path");
      const fs = await import("fs");

      const pdfBuffer = await generatePdfBuffer({
        car: lap.car,
        track: lap.track,
        layout: lap.layout,
        lapNumber: lap.lapNumber,
        lapTime: lap.lapTime,
        sector1: lap.sectorTimes[0] ?? null,
        sector2: lap.sectorTimes[1] ?? null,
        sector3: lap.sectorTimes[2] ?? null,
        condition: "Asciutto",
        sessionType: "Sessione",
        recordedAt: analysis.generatedAt,
        templateV3: analysis.templateV3,
        game: lap.game ?? "r3e",
      });

      const outputDir = path.join(
        process.env.APPDATA ?? ".",
        "sim-coach",
        "reports",
      );
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filename = `lap${lap.lapNumber}_${lap.car.replace(/\s+/g, "_")}_${Date.now()}.pdf`;
      const outputPath = path.join(outputDir, filename);
      fs.writeFileSync(outputPath, pdfBuffer);

      return outputPath;
    } catch (err) {
      console.error("[CoachEngine] PDF generation error:", err);
      return null;
    }
  };

  return {
    updateCornerNames: (names) => {
      cornerNames = names;
    },
    updateApiKey: (apiKey) => {
      client = new Anthropic({ apiKey });
    },

    analyzeLap: async (lap, deviations) => {
      const prompt = buildPrompt(lap, deviations, cornerNames);
      let fullText = "";

      try {
        const stream = client.messages.stream({
          model,
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
          }
        }

        await stream.finalMessage();
      } catch (err) {
        console.error("[CoachEngine] Claude API error:", err);
        return;
      }

      const analysis: LapAnalysis = {
        lapNumber: lap.lapNumber,
        lapTime: lap.lapTime,
        templateV3: fullText,
        section5Summary: extractSection5(fullText),
        generatedAt: new Date().toISOString(),
      };

      saveAnalysis(lap, analysis);

      const pdfPath = await generatePdf(lap, analysis);
      if (pdfPath) updatePdfPath(lap, pdfPath);

      onAnalysis(analysis);
    },
  };
};
