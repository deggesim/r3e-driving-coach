/**
 * useVoiceCoach — integrates gamepad trigger, Web Speech API (STT),
 * voice query IPC, and Azure/Web Speech TTS playback.
 *
 * Flow:
 *   gamepad button press
 *     → start SpeechRecognition (it-IT)
 *     → transcript → IPC coach:voiceQuery
 *     → streaming tokens via coach:voiceChunk
 *     → coach:voiceDone (full answer)
 *     → coach:voiceAudio (MP3 buffer, if Azure TTS enabled)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useGamepad } from "./useGamepad";

// ── SpeechRecognition types (not universally in TS DOM lib) ───────────────────

interface ISpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}

interface ISpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: ISpeechRecognitionConstructor;
    webkitSpeechRecognition?: ISpeechRecognitionConstructor;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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

export const useVoiceCoach = ({
  triggerButtonIndex,
  enabled,
  azureTtsEnabled,
}: UseVoiceCoachOptions): UseVoiceCoachResult => {
  const [state, setState] = useState<VoiceCoachState>("idle");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetToIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setState("idle");
      setTranscript("");
      setAnswer("");
    }, 3000);
  }, []);

  const triggerListening = useCallback(() => {
    if (!enabled) return;
    if (state !== "idle") return;

    // Cancel any in-flight Web Speech TTS
    window.speechSynthesis.cancel();

    // Stop any Azure audio
    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    const SpeechRecognitionImpl =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionImpl) {
      console.warn("[VoiceCoach] SpeechRecognition not available");
      return;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = "it-IT";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    setState("listening");
    setTranscript("");
    setAnswer("");

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const text = event.results[0]?.[0]?.transcript ?? "";
      setTranscript(text);
      setState("processing");

      if (text.trim()) {
        window.electronAPI.voiceQuery(text).catch(console.error);
      } else {
        setState("idle");
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("[VoiceCoach] SpeechRecognition error:", event.error);
      setState("idle");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
    };

    recognition.start();
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

      // If Azure TTS is NOT enabled, speak the answer via Web Speech API
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
      recognitionRef.current?.abort();
      audioCtxRef.current?.close();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  return { state, transcript, answer, triggerListening };
};
