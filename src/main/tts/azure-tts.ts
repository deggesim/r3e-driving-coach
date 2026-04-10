/**
 * Azure Cognitive Services TTS — REST API wrapper.
 *
 * Uses axios for all HTTP calls (shared instance per request, base URL varies by region).
 * Endpoints:
 *   - Voices list: GET  https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list
 *   - Synthesis:   POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 */

import axios from "axios";
import type { AzureVoice } from "../../shared/types";

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

  // Escape XML special chars in text
  const escaped = text
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
