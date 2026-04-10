/**
 * TTSManager — Headless component that manages TTS output.
 *
 * When azureEnabled: routes through Azure Cognitive Services TTS (MP3 via IPC).
 * When not: uses Web Speech API (SpeechSynthesisUtterance, it-IT).
 *
 * Priority queue: P1 interrupts current speech, P2/P3 are queued.
 * Post-lap: reads Section [5] of Template v3 (passed as postLapText).
 */

import { useEffect, useRef, useCallback } from "react";
import type { Alert } from "../../shared/types";

type TTSManagerProps = {
  alerts: Alert[];
  postLapText: string | null;
  enabled?: boolean;
  azureEnabled?: boolean;
};

type QueuedUtterance = {
  text: string;
  priority: 1 | 2 | 3;
};

// Decode an IPC-transferred Buffer/object to ArrayBuffer
const toArrayBuffer = (data: unknown): ArrayBuffer => {
  if (data instanceof ArrayBuffer) return data;
  // Buffer serialized over IPC arrives as a plain object with numeric keys
  const bytes = new Uint8Array(Object.values(data as Record<string, number>));
  return bytes.buffer;
};

const TTSManager = ({
  alerts,
  postLapText,
  enabled = true,
  azureEnabled = false,
}: TTSManagerProps) => {
  const queueRef = useRef<QueuedUtterance[]>([]);
  const speakingRef = useRef(false);
  const lastAlertRef = useRef<Alert | null>(null);
  const lastPostLapRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Capture initial azureEnabled for the mount-only welcome effect
  const azureEnabledAtMountRef = useRef(azureEnabled);

  // ── Azure TTS path ──────────────────────────────────────────────────────────

  const speakAzure = useCallback(
    async (text: string, onDone: () => void) => {
      try {
        const raw = await window.electronAPI.ttsSynthesize(text);
        const arrayBuffer = toArrayBuffer(raw);
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
          onDone();
        };
      } catch (err) {
        console.error("[TTSManager] Azure TTS error:", err);
        onDone();
      }
    },
    [],
  );

  // ── Web Speech path ─────────────────────────────────────────────────────────

  const speakNext = useCallback(() => {
    if (!enabled || speakingRef.current || queueRef.current.length === 0) return;

    const item = queueRef.current.shift()!;
    speakingRef.current = true;

    if (azureEnabled) {
      speakAzure(item.text, () => {
        speakingRef.current = false;
        speakNext();
      });
      return;
    }

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = "it-IT";
    utterance.rate = 0.9;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const itVoice = voices.find((v) => v.lang.startsWith("it"));
    if (itVoice) utterance.voice = itVoice;

    utterance.onend = () => {
      speakingRef.current = false;
      speakNext();
    };

    utterance.onerror = () => {
      speakingRef.current = false;
      speakNext();
    };

    window.speechSynthesis.speak(utterance);
  }, [enabled, azureEnabled, speakAzure]);

  const stopCurrent = useCallback(() => {
    if (azureEnabled) {
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    } else {
      window.speechSynthesis.cancel();
    }
    speakingRef.current = false;
  }, [azureEnabled]);

  const enqueue = useCallback(
    (text: string, priority: 1 | 2 | 3) => {
      if (!enabled) return;

      if (priority === 1) {
        stopCurrent();
        queueRef.current = [
          { text, priority },
          ...queueRef.current.filter((q) => q.priority === 1),
        ];
      } else {
        const insertAt = queueRef.current.findIndex(
          (q) => q.priority > priority,
        );
        if (insertAt === -1) {
          queueRef.current.push({ text, priority });
        } else {
          queueRef.current.splice(insertAt, 0, { text, priority });
        }
      }

      speakNext();
    },
    [enabled, stopCurrent, speakNext],
  );

  // React to new alerts
  useEffect(() => {
    if (alerts.length === 0) return;
    const latest = alerts[alerts.length - 1];
    if (latest === lastAlertRef.current) return;
    lastAlertRef.current = latest;
    enqueue(latest.message, latest.priority);
  }, [alerts, enqueue]);

  // React to new post-lap text
  useEffect(() => {
    if (!postLapText || postLapText === lastPostLapRef.current) return;
    lastPostLapRef.current = postLapText;
    enqueue(postLapText, 3);
  }, [postLapText, enqueue]);

  // Welcome message on first mount
  useEffect(() => {
    const speakWelcome = async () => {
      if (azureEnabledAtMountRef.current) {
        try {
          const raw = await window.electronAPI.ttsSynthesize(
            "Ciao, sono pronto ad aiutarti in pista",
          );
          const arrayBuffer = toArrayBuffer(raw);
          const ctx = new AudioContext();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.start(0);
          source.onended = () => ctx.close();
        } catch {
          // Fall through to Web Speech
          speakWelcomeWebSpeech();
        }
        return;
      }
      speakWelcomeWebSpeech();
    };

    const speakWelcomeWebSpeech = () => {
      const utterance = new SpeechSynthesisUtterance(
        "Ciao, sono pronto ad aiutarti in pista",
      );
      utterance.lang = "it-IT";
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const itVoice = voices.find((v) => v.lang.startsWith("it"));
      if (itVoice) utterance.voice = itVoice;
      window.speechSynthesis.speak(utterance);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0 || azureEnabledAtMountRef.current) {
      speakWelcome().catch(console.error);
    } else {
      const timer = setTimeout(() => speakWelcome().catch(console.error), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    window.speechSynthesis.onvoiceschanged = () => {
      /* voices now available — next speak call will pick them up */
    };
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      audioCtxRef.current?.close();
    };
  }, []);

  return null;
};

export default TTSManager;
