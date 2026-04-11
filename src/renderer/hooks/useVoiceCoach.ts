/**
 * useVoiceCoach — integrates gamepad trigger, MediaRecorder (audio capture),
 * Azure STT via IPC, voice query IPC, and Azure/Web Speech TTS playback.
 *
 * Flow:
 *   gamepad button press
 *     → getUserMedia + MediaRecorder (up to MAX_RECORD_MS)
 *     → audio ArrayBuffer → IPC stt:transcribe (Azure STT)
 *     → transcript → IPC coach:voiceQuery
 *     → streaming tokens via coach:voiceChunk
 *     → coach:voiceDone (full answer)
 *     → coach:voiceAudio (MP3 buffer, if Azure TTS enabled)
 *
 * Replaces Web Speech API which fails in Electron with a "network" error
 * because Chrome's embedded speech API key is not usable outside Chrome.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useGamepad } from "./useGamepad";

export type VoiceCoachState = "idle" | "listening" | "processing" | "speaking";

type UseVoiceCoachOptions = {
  triggerButtonIndex: number;
  enabled: boolean;
  azureTtsEnabled: boolean;
};

type UseVoiceCoachResult = {
  state: VoiceCoachState;
  transcript: string;
  answer: string;
  triggerListening: () => void;
};

/** Convert an IPC-transferred value (Buffer serialized as plain object) to ArrayBuffer. */
const toArrayBuffer = (data: unknown): ArrayBuffer => {
  if (data instanceof ArrayBuffer) return data;
  const values = Object.values(data as Record<string, number>);
  return new Uint8Array(values).buffer;
};

/** Max recording duration in ms before auto-stopping. */
const MAX_RECORD_MS = 8000;

/** Pick the best supported MIME type for MediaRecorder. */
const pickMimeType = (): string => {
  for (const type of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
};

/**
 * Convert any audio Blob (WebM/Opus, Ogg, etc.) to WAV PCM 16-bit mono 16 kHz.
 *
 * Azure STT REST API accepts WebM/Opus in theory but in practice returns
 * Success with an empty transcript. WAV/PCM is the only format the REST
 * endpoint handles reliably without the full Azure Speech SDK.
 */
const convertToWav = async (blob: Blob): Promise<ArrayBuffer> => {
  const raw = await blob.arrayBuffer();

  // Decode compressed audio into a float32 PCM AudioBuffer
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(raw);
  await decodeCtx.close();

  // Resample + downmix to mono 16 kHz using OfflineAudioContext
  const TARGET_RATE = 16000;
  const numFrames = Math.ceil(decoded.duration * TARGET_RATE);
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();

  // Encode as WAV (RIFF PCM 16-bit LE)
  const samples = rendered.getChannelData(0);
  const dataBytes = samples.length * 2; // 16-bit = 2 bytes per sample
  const wav = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wav);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);          // chunk size
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, TARGET_RATE, true); // sample rate
  view.setUint32(28, TARGET_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return wav;
};

export const useVoiceCoach = ({
  triggerButtonIndex,
  enabled,
  azureTtsEnabled,
}: UseVoiceCoachOptions): UseVoiceCoachResult => {
  const [state, setState] = useState<VoiceCoachState>("idle");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const resetToIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setState("idle");
      setTranscript("");
      setAnswer("");
    }, 3000);
  }, []);

  const triggerListening = useCallback(() => {
    if (!enabled || state !== "idle") return;

    // Cancel any ongoing TTS
    window.speechSynthesis.cancel();
    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    setState("listening");
    setTranscript("");
    setAnswer("");

    const mimeType = pickMimeType();

    console.log("[VoiceCoach] Requesting microphone, mimeType:", mimeType || "(browser default)");

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        console.log("[VoiceCoach] Mic stream acquired, tracks:", stream.getAudioTracks().map((t) => t.label));
        streamRef.current = stream;

        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        recorderRef.current = recorder;
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          console.log("[VoiceCoach] ondataavailable size:", e.data.size);
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          // Release mic
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          recorderRef.current = null;

          const effectiveMime = mimeType || "audio/webm;codecs=opus";
          const blob = new Blob(chunks, { type: effectiveMime });
          console.log("[VoiceCoach] Recording stopped, blob size:", blob.size, "mime:", effectiveMime);

          if (blob.size === 0) {
            console.warn("[VoiceCoach] Empty recording — mic may be muted or silent");
            setState("idle");
            return;
          }

          convertToWav(blob)
            .then((buf) => {
              console.log("[VoiceCoach] Converted to WAV:", buf.byteLength, "bytes");
              setState("processing");
              return window.electronAPI.sttTranscribe(buf, "audio/wav");
            })
            .then((text) => {
              if (text.trim()) {
                setTranscript(text);
                return window.electronAPI.voiceQuery(text);
              } else {
                // Nothing recognised — go back to idle
                setState("idle");
              }
            })
            .catch((err: unknown) => {
              console.error("[VoiceCoach] STT error:", err);
              setState("idle");
            });
        };

        recorder.start();
        console.log("[VoiceCoach] Recording started");

        // Auto-stop after MAX_RECORD_MS
        setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, MAX_RECORD_MS);
      })
      .catch((err: unknown) => {
        console.error("[VoiceCoach] Microphone access error:", err);
        setState("idle");
      });
  }, [enabled, state]);

  // Subscribe to voice coach push channels
  useEffect(() => {
    if (!enabled) return;

    let accum = "";

    const handleChunk = (data: unknown) => {
      const { token } = data as { token: string };
      accum += token;
      setAnswer(accum);
      setState("speaking");
    };

    const handleDone = (data: unknown) => {
      const { answer: fullAnswer } = data as { answer: string };
      accum = fullAnswer;
      setAnswer(fullAnswer);
      setState("speaking");

      // If Azure TTS is NOT enabled, speak via Web Speech API
      if (!azureTtsEnabled) {
        const utterance = new SpeechSynthesisUtterance(fullAnswer);
        utterance.lang = "it-IT";
        utterance.rate = 0.9;
        const voices = window.speechSynthesis.getVoices();
        const itVoice = voices.find((v) => v.lang.startsWith("it"));
        if (itVoice) utterance.voice = itVoice;
        utterance.onend = resetToIdle;
        utterance.onerror = resetToIdle;
        window.speechSynthesis.speak(utterance);
      }
    };

    const handleAudio = async (data: unknown) => {
      if (!azureTtsEnabled) return;
      const { audio } = data as { audio: unknown };
      const arrayBuffer = toArrayBuffer(audio);

      setState("speaking");
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start(0);
        source.onended = () => {
          ctx.close();
          audioCtxRef.current = null;
          resetToIdle();
        };
      } catch (err) {
        console.error("[VoiceCoach] Audio playback error:", err);
        resetToIdle();
      }
    };

    window.electronAPI.onVoiceChunk(handleChunk);
    window.electronAPI.onVoiceDone(handleDone);
    window.electronAPI.onVoiceAudio((d) => {
      handleAudio(d).catch(console.error);
    });

    return () => {
      window.electronAPI.removeAllListeners("coach:voiceChunk");
      window.electronAPI.removeAllListeners("coach:voiceDone");
      window.electronAPI.removeAllListeners("coach:voiceAudio");
    };
  }, [enabled, azureTtsEnabled, resetToIdle]);

  // Gamepad trigger
  useGamepad({
    buttonIndex: triggerButtonIndex,
    onButtonPress: triggerListening,
    enabled,
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  return { state, transcript, answer, triggerListening };
};
