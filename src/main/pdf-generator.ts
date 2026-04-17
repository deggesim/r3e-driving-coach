/**
 * pdf-generator.ts
 * Generates lap analysis PDFs via Electron's printToPDF + HTML/CSS rendering.
 * Replaces the jsPDF approach to match the styled template layout.
 */

import { BrowserWindow } from "electron";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { marked } from "marked";
import type { GameSource } from "../shared/types.js";

export type PdfData = {
  car: string;
  track: string;
  layout: string;
  lapNumber: number;
  lapTime: number;
  sector1: number | null;
  sector2: number | null;
  sector3: number | null;
  /** e.g. "Asciutto" */
  condition?: string;
  /** e.g. "Qualifica" | "Pratica" */
  sessionType?: string;
  recordedAt: string;
  /** Optional display name for the active setup */
  setupName?: string;
  /** Full template v3 markdown text */
  templateV3: string | null;
  /** Structured setup params for the Setup table */
  setupParams?: Array<{ category: string; parameter: string; value: string }>;
  /** Source simulator */
  game?: GameSource;
};

const GAME_LABELS: Record<GameSource, { short: string; full: string }> = {
  r3e: { short: "R3E", full: "RaceRoom Racing Experience" },
  ace: { short: "ACE", full: "Assetto Corsa EVO" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(s: number | null): string {
  if (!s || s <= 0) return "--:--";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0
    ? `${m}:${sec.toFixed(3).padStart(6, "0")}`
    : `${sec.toFixed(3)}s`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Post-processes rendered HTML to add inline styling for:
 * - @Xm distance markers → blue badge
 * - ✔ → green
 * - ✗ → red
 * - "In sessione" / "Tra sessioni" hint text coloring
 */
function postProcess(html: string): string {
  html = html.replace(/@(\d+m)/g, '<span class="dist-marker">@$1</span>');
  html = html.replace(/✔/g, '<span class="avail-yes">✔</span>');
  html = html.replace(/✗/g, '<span class="avail-no">✗</span>');
  // ● bullet used for problem headers in some prompts
  html = html.replace(/●/g, "•");
  return html;
}

/**
 * Parses templateV3 markdown into section blocks and returns their HTML.
 */
function buildSectionsHtml(templateV3: string): string {
  // Split on [N] markers, keeping the delimiter
  const parts = templateV3.split(/(?=\[\d\])/);
  return parts
    .map((sect) => {
      const match = sect.match(/^\[(\d)\]\s*([^\n]*)/);
      if (!match) return "";
      const [, num, title] = match;
      const body = sect.replace(/^\[\d\][^\n]*\n?/, "").trim();
      const bodyHtml = postProcess(String(marked.parse(body)));
      return `
    <div class="section">
      <div class="section-header">[${num}] ${escapeHtml(title.trim())}</div>
      <div class="section-body">${bodyHtml}</div>
    </div>`;
    })
    .join("\n");
}

/**
 * Builds the structured Setup table HTML (shown after analysis sections).
 */
function buildSetupTableHtml(
  params: Array<{ category: string; parameter: string; value: string }>,
): string {
  const rows = params
    .map(
      (p, i) => `
      <tr${i % 2 !== 0 ? ' class="alt"' : ""}>
        <td>${escapeHtml(p.category)}</td>
        <td>${escapeHtml(p.parameter)}</td>
        <td class="value">${escapeHtml(p.value)}</td>
      </tr>`,
    )
    .join("");

  return `
    <div class="section">
      <div class="section-header">Setup Auto</div>
      <div class="section-body">
        <table class="setup-table">
          <thead>
            <tr><th>Categoria</th><th>Parametro</th><th>Valore</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── HTML Builder ──────────────────────────────────────────────────────────────

export function buildPdfHtml(data: PdfData): string {
  const lapTimeStr = fmtTime(data.lapTime);
  const s1 = fmtTime(data.sector1);
  const s2 = fmtTime(data.sector2);
  const s3 = fmtTime(data.sector3);
  const sessionDate = new Date(data.recordedAt).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const condition = escapeHtml(data.condition ?? "Asciutto");
  const sessionType = escapeHtml(data.sessionType ?? "Sessione");
  const trackLine = [data.track, data.layout]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" ");

  const sectionsHtml = data.templateV3
    ? buildSectionsHtml(data.templateV3)
    : "";
  const setupHtml = data.setupParams?.length
    ? buildSetupTableHtml(data.setupParams)
    : "";

  const gameLabel = GAME_LABELS[data.game ?? "r3e"];

  const infoItems = [
    `Simulatore: ${gameLabel.short}`,
    `Tempo: <span class="laptime">${lapTimeStr}</span>`,
    `S1: ${s1} &nbsp;S2: ${s2} &nbsp;S3: ${s3}`,
    ...(data.setupName ? [`Setup: ${escapeHtml(data.setupName)}`] : []),
  ];

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<style>
/* ── Page layout ── */
@page {
  size: A4;
  margin: 14mm 15mm 18mm 15mm;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 9pt;
  color: #2d3748;
  background: #fff;
  line-height: 1.55;
}

/* ── Header ── */
.header {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 2px solid #e2e8f0;
}
.header-car {
  font-size: 18pt;
  font-weight: 800;
  color: #1a202c;
  line-height: 1.2;
  margin-bottom: 3px;
  letter-spacing: -0.3px;
}
.header-track {
  font-size: 10pt;
  color: #718096;
  margin-bottom: 5px;
}
.header-info {
  font-size: 8pt;
  color: #4a5568;
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 5px 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 0 12px;
}
.header-info .sep { color: #cbd5e0; }
.laptime { color: #e8451a; font-weight: 700; }

/* ── Sections ── */
.section { margin-bottom: 11px; }
.section-header {
  background: #2d3748;
  color: #fff;
  font-weight: 700;
  font-size: 9.5pt;
  padding: 5px 10px;
  border-radius: 3px;
  margin-bottom: 6px;
  page-break-after: avoid;
}
.section-body { padding: 0 4px; font-size: 8.5pt; }

/* ── Typography within sections ── */
.section-body h1,
.section-body h2,
.section-body h3 {
  font-size: 9pt;
  font-weight: 700;
  color: #1a202c;
  margin: 8px 0 3px 0;
  page-break-after: avoid;
}
.section-body h4,
.section-body h5,
.section-body h6 {
  font-size: 8.5pt;
  font-weight: 700;
  color: #1a202c;
  margin: 6px 0 2px 0;
}
.section-body p { margin: 3px 0; }
.section-body ul,
.section-body ol { padding-left: 14px; margin: 3px 0; }
.section-body li { margin: 2px 0; }
.section-body strong { color: #1a202c; }
.section-body blockquote {
  border-left: 3px solid #cbd5e0;
  margin: 4px 0;
  padding: 2px 8px;
  color: #718096;
  font-style: italic;
}
.section-body code {
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  padding: 1px 3px;
  font-family: monospace;
  font-size: 7.5pt;
}
.section-body hr {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 6px 0;
}

/* ── Distance markers ── */
.dist-marker {
  background: #ebf8ff;
  color: #2b6cb0;
  font-size: 7.5pt;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  white-space: nowrap;
}

/* ── Availability markers ── */
.avail-yes { color: #276749; font-weight: 600; }
.avail-no  { color: #c53030; font-weight: 600; }

/* ── Tables (markdown + setup) ── */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 8pt;
  margin: 5px 0;
}
thead tr { background: #2d3748; color: #fff; }
thead th {
  padding: 5px 7px;
  text-align: left;
  font-weight: 700;
  font-size: 8pt;
}
tbody tr { background: #fff; }
tbody tr.alt,
tbody tr:nth-child(even) { background: #f7fafc; }
tbody td {
  padding: 4px 7px;
  color: #2d3748;
  vertical-align: top;
  border-bottom: 1px solid #edf2f7;
}
.setup-table td.value { color: #c05621; font-weight: 600; }

/* ── Footer ── */
.footer {
  margin-top: 14px;
  padding-top: 6px;
  border-top: 1px solid #e2e8f0;
  font-size: 7pt;
  color: #a0aec0;
}
</style>
</head>
<body>

<div class="header">
  <div class="header-car">${escapeHtml(data.car)}</div>
  <div class="header-track">${trackLine} | ${sessionType} | ${condition}</div>
  <div class="header-info">
    ${infoItems.join('<span class="sep"> &nbsp;|&nbsp; </span>')}
  </div>
</div>

${sectionsHtml}
${setupHtml}

<div class="footer">
  Analisi generata da Sim Driving Coach &bull; Simulatore: ${gameLabel.full} &bull; ${sessionDate}
</div>

</body>
</html>`;
}

// ── PDF Buffer Generator ──────────────────────────────────────────────────────

/**
 * Renders the HTML to a PDF buffer using a hidden Electron BrowserWindow.
 * The window is always closed (and the temp file deleted) even on error.
 */
export async function generatePdfBuffer(data: PdfData): Promise<Buffer> {
  const html = buildPdfHtml(data);
  const tmpFile = path.join(os.tmpdir(), `sim-coach-pdf-${Date.now()}.html`);
  fs.writeFileSync(tmpFile, html, "utf-8");

  const win = new BrowserWindow({
    width: 794,
    height: 1123,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  try {
    await win.loadFile(tmpFile);
    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
    });
    return buffer;
  } finally {
    win.close();
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Temp file cleanup is best-effort
    }
  }
}
