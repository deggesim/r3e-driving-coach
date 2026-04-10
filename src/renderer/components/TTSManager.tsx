/**
 * TTSManager — Headless component that manages Web Speech API (it-IT).
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
};

type QueuedUtterance = {
  text: string;
  priority: 1 | 2 | 3;
};

export default function TTSManager({
  alerts,
  postLapText,
  enabled = true,
}: TTSManagerProps) {
  const queueRef = useRef<QueuedUtterance[]>([]);
  const speakingRef = useRef(false);
  const lastAlertRef = useRef<Alert | null>(null);
  const lastPostLapRef = useRef<string | null>(null);

  const speakNext = useCallback(() => {
    if (!enabled || speakingRef.current || queueRef.current.length === 0)
      return;

    const item = queueRef.current.shift()!;
    speakingRef.current = true;

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = "it-IT";
    utterance.rate = 0.9;
    utterance.pitch = 1.0;

    // Pick an Italian voice if available
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
  }, [enabled]);

  const enqueue = useCallback(
    (text: string, priority: 1 | 2 | 3) => {
      if (!enabled) return;

      if (priority === 1) {
        // P1: interrupt immediately
        window.speechSynthesis.cancel();
        speakingRef.current = false;
        queueRef.current = [
          { text, priority },
          ...queueRef.current.filter((q) => q.priority === 1),
        ];
      } else {
        // Insert by priority (lower number = higher priority)
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
    [enabled, speakNext],
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
    const speakWelcome = () => {
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

    // Voices may not be ready yet — retry after a short delay
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      speakWelcome();
    } else {
      const timer = setTimeout(speakWelcome, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Voices may load async — retry on change
  useEffect(() => {
    window.speechSynthesis.onvoiceschanged = () => {
      /* voices now available — next speak call will pick them up */
    };
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  return null; // headless component
}
