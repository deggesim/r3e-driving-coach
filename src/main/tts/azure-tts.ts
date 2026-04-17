/**
 * Azure Cognitive Services TTS — REST API wrapper.
 *
 * Uses axios for all HTTP calls (shared instance per request, base URL varies by region).
 * Endpoints:
 *   - Voices list: GET  https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list
 *   - Synthesis:   POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 */

import axios from "axios";
import type { AzureVoice } from "../../shared/types.js";

// ---------------------------------------------------------------------------
// Italian TTS text preprocessing
// ---------------------------------------------------------------------------

/** Convert an integer (0–9999) to Italian words. */
function numberToItalian(n: number): string {
  if (n === 0) return "zero";

  const ones = [
    "", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove",
    "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici",
    "diciassette", "diciotto", "diciannove",
  ];
  const tens = [
    "", "", "venti", "trenta", "quaranta", "cinquanta",
    "sessanta", "settanta", "ottanta", "novanta",
  ];

  if (n < 20) return ones[n];

  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    // Italian rule: drop final vowel of tens word before 1 or 8 (ventuno, ventotto…)
    const tensWord = (u === 1 || u === 8) ? tens[t].slice(0, -1) : tens[t];
    return tensWord + (u > 0 ? ones[u] : "");
  }

  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const hundredsWord = h === 1 ? "cento" : ones[h] + "cento";
    return hundredsWord + (rest > 0 ? numberToItalian(rest) : "");
  }

  // 1 000–9 999
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  const thousandsWord = th === 1 ? "mille" : numberToItalian(th) + "mila";
  return thousandsWord + (rest > 0 ? numberToItalian(rest) : "");
}

/** Tenth-of-a-second words (0–9). */
const TENTH_WORDS = [
  "zero", "uno", "due", "tre", "quattro",
  "cinque", "sei", "sette", "otto", "nove",
];

/**
 * Expand track-position markers and lap-time deltas into spoken Italian.
 *
 * Rules applied (before XML escaping):
 *   @1352m  →  "milletrecentocinquantadue metri"
 *   0.2s    →  "due decimi"          (sub-second)
 *   1.3s    →  "un secondo e tre decimi"
 *   2.0s    →  "due secondi"
 */
function preprocessTTSText(text: string): string {
  // Track position: @<meters>m
  text = text.replace(/@(\d+)m\b/g, (_m, digits) => {
    return numberToItalian(parseInt(digits, 10)) + " metri";
  });

  // Lap-time delta: <sec>.<tenth>s
  text = text.replace(/\b(\d+)\.(\d)s\b/g, (_m, secStr, tenthStr) => {
    const sec = parseInt(secStr, 10);
    const tenth = parseInt(tenthStr, 10);

    const tenthPhrase =
      tenth === 1 ? "un decimo" : `${TENTH_WORDS[tenth]} decimi`;

    if (sec === 0) {
      // Sub-second: only tenths
      return tenthPhrase;
    }

    const secPhrase = sec === 1 ? "un secondo" : `${numberToItalian(sec)} secondi`;
    if (tenth === 0) return secPhrase;
    return `${secPhrase} e ${tenthPhrase}`;
  });

  return text;
}


/** Create a region-scoped axios instance for Azure Speech endpoints. */
const createAzureClient = (region: string, key: string) =>
  axios.create({
    baseURL: `https://${region}.tts.speech.microsoft.com/cognitiveservices`,
    headers: { "Ocp-Apim-Subscription-Key": key },
  });

/**
 * Fetch available voices for a given region, filtered to Italian (it-IT).
 */
export const getAzureVoices = async (
  key: string,
  region: string,
): Promise<AzureVoice[]> => {
  const client = createAzureClient(region, key);
  const { data } = await client.get<AzureVoice[]>("/voices/list");
  console.log("data", data);
  return data.filter((v) => v.Locale.startsWith("it-IT"));
};

/**
 * Synthesize text to MP3 audio using Azure TTS.
 * Returns a Buffer containing MP3 bytes.
 */
export const synthesizeAzure = async (
  text: string,
  key: string,
  region: string,
  voiceName: string,
): Promise<Buffer> => {
  const client = createAzureClient(region, key);

  // Expand track-position markers and time deltas before XML escaping
  const processed = preprocessTTSText(text);

  // Escape XML special chars in text
  const escaped = processed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const ssml = `<speak version='1.0' xml:lang='it-IT'><voice name='${voiceName}'>${escaped}</voice></speak>`;

  const { data } = await client.post<ArrayBuffer>("/v1", ssml, {
    headers: {
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
    },
    responseType: "arraybuffer",
  });

  return Buffer.from(data);
};

/**
 * Transcribe audio using Azure Speech-to-Text REST API.
 * @param audioBuffer  Raw audio bytes (WebM/Opus from MediaRecorder)
 * @param key          Azure Speech subscription key
 * @param region       Azure region (e.g. "westeurope")
 * @param mimeType     MIME type of the audio (must match what MediaRecorder produced)
 * @returns            Recognized text, or empty string if nothing was heard
 */
export const transcribeAzure = async (
  audioBuffer: Buffer,
  key: string,
  region: string,
  mimeType = "audio/wav",
): Promise<string> => {
  const url =
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation` +
    `/cognitiveservices/v1?language=it-IT&format=simple`;

  console.log(
    `[Azure STT] Sending ${audioBuffer.byteLength} bytes as ${mimeType}`,
  );

  const { data } = await axios.post<{ RecognitionStatus: string; DisplayText?: string }>(
    url,
    audioBuffer,
    {
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": mimeType,
      },
    },
  );

  console.log("[Azure STT] Status:", data.RecognitionStatus, "| Text:", data.DisplayText ?? "(none)");

  if (data.RecognitionStatus === "Success") {
    return data.DisplayText ?? "";
  }

  // Surface the Azure status so callers can distinguish "silence" from errors
  throw new Error(`Azure STT: ${data.RecognitionStatus}`);
};
