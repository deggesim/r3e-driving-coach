/**
 * CoachEngine — calls Claude API per lap, saves analysis to SQLite, generates PDF.
 *
 * Uses claude-sonnet-4-6 with streaming (as per project spec).
 * Emits the Template v3 analysis via the onAnalysis callback.
 */

import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import { SYSTEM_PROMPT, buildPrompt } from "./prompt-builder";
import type { LapRecord, Deviation, LapAnalysis } from "../../shared/types";

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
  const sentences = raw.match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences.slice(0, 5).join(" ").trim();
};

const formatLapTime = (seconds: number): string => {
  if (seconds <= 0 || !isFinite(seconds)) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0
    ? `${mins}:${secs.toFixed(3).padStart(6, "0")}`
    : `${secs.toFixed(3)}s`;
};

export const createCoachEngine = (options: CoachEngineOptions): CoachEngine => {
  const db = options.db;
  const onAnalysis = options.onAnalysis;
  const model = options.model ?? "claude-sonnet-4-6";
  let client = new Anthropic({ apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY });
  let cornerNames = new Map<number, string>();

  const saveAnalysis = (lap: LapRecord, analysis: LapAnalysis): void => {
    try {
      db.prepare(`
        UPDATE laps SET analysis_json = ?
        WHERE session_id = (
          SELECT id FROM sessions
          WHERE car = ? AND track = ? AND layout = ?
          ORDER BY started_at DESC LIMIT 1
        ) AND lap_number = ?
      `).run(JSON.stringify(analysis), lap.car, lap.track, lap.layout, lap.lapNumber);
    } catch (err) {
      console.error("[CoachEngine] DB save error:", err);
    }
  };

  const updatePdfPath = (lap: LapRecord, pdfPath: string): void => {
    try {
      db.prepare(`
        UPDATE laps SET pdf_path = ?
        WHERE session_id = (
          SELECT id FROM sessions
          WHERE car = ? AND track = ? AND layout = ?
          ORDER BY started_at DESC LIMIT 1
        ) AND lap_number = ?
      `).run(pdfPath, lap.car, lap.track, lap.layout, lap.lapNumber);
    } catch {
      // Non-critical
    }
  };

  const generatePdf = async (lap: LapRecord, analysis: LapAnalysis): Promise<string | null> => {
    try {
      // Dynamic import to avoid loading jsPDF in main process startup
      const { jsPDF } = await import("jspdf");
      const path = await import("path");
      const fs = await import("fs");

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;
      let y = 20;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(`R3E Driving Coach — Analisi Giro ${lap.lapNumber}`, margin, y);
      y += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text(`${lap.car} | ${lap.track} ${lap.layout} | ${formatLapTime(lap.lapTime)}`, margin, y);
      y += 6;
      doc.text(`Generato: ${new Date(analysis.generatedAt).toLocaleString("it-IT")}`, margin, y);
      y += 10;

      doc.setDrawColor(100);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      doc.setFontSize(10);
      const lines = doc.splitTextToSize(analysis.templateV3, contentWidth);
      for (const line of lines) {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        const isHeader = /^\[(\d)\]/.test(line);
        doc.setFont("helvetica", isHeader ? "bold" : "normal");
        doc.text(line, margin, y);
        y += isHeader ? 7 : 5;
      }

      const outputDir = path.join(process.env.APPDATA ?? ".", "r3e-coach", "reports");
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const filename = `lap${lap.lapNumber}_${lap.car.replace(/\s+/g, "_")}_${Date.now()}.pdf`;
      const outputPath = path.join(outputDir, filename);
      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      fs.writeFileSync(outputPath, pdfBuffer);

      return outputPath;
    } catch (err) {
      console.error("[CoachEngine] PDF generation error:", err);
      return null;
    }
  };

  return {
    updateCornerNames: (names) => { cornerNames = names; },
    updateApiKey: (apiKey) => { client = new Anthropic({ apiKey }); },

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
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
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
