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
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
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

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;

        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = recorder;
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          // Release mic
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          recorderRef.current = null;

          const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
          blob
            .arrayBuffer()
            .then((buf) => {
              setState("processing");
              return window.electronAPI.sttTranscribe(buf);
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
