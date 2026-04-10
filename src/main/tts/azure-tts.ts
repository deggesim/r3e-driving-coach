/**
 * Azure Cognitive Services TTS — REST API wrapper.
 *
 * No SDK required — uses Node 18+ built-in fetch.
 * Endpoints:
 *   - Voices list: GET https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list
 *   - Synthesis:   POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 */

export type AzureVoice = {
  name: string;        // e.g. "Microsoft Server Speech Text to Speech Voice (it-IT, ElsaNeural)"
  shortName: string;   // e.g. "it-IT-ElsaNeural"
  localName: string;   // e.g. "Elsa"
  locale: string;      // e.g. "it-IT"
  gender: string;      // "Female" | "Male"
};

/**
 * Fetch available voices for a given region, filtered to Italian (it-IT).
 */
export const getAzureVoices = async (
  key: string,
  region: string,
): Promise<AzureVoice[]> => {
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
  const res = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": key },
  });

  if (!res.ok) {
    throw new Error(`Azure voices fetch failed: ${res.status} ${res.statusText}`);
  }

  const all = (await res.json()) as AzureVoice[];
  return all.filter((v) => v.locale.startsWith("it-IT"));
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
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  // Escape XML special chars in text
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const ssml = `<speak version='1.0' xml:lang='it-IT'><voice name='${voiceName}'>${escaped}</voice></speak>`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
    },
    body: ssml,
  });

  if (!res.ok) {
    throw new Error(`Azure TTS synthesis failed: ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};
