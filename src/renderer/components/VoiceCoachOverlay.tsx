/**
 * VoiceCoachOverlay — fixed overlay showing voice interaction state.
 *
 * States:
 *   idle      → hidden
 *   listening → pulsing mic + "In ascolto..."
 *   processing → spinner + transcript
 *   speaking  → streaming answer text
 */

import type { VoiceCoachState } from "../hooks/useVoiceCoach";

type VoiceCoachOverlayProps = {
  state: VoiceCoachState;
  transcript: string;
  answer: string;
};

const VoiceCoachOverlay = ({
  state,
  transcript,
  answer,
}: VoiceCoachOverlayProps) => {
  if (state === "idle") return null;

  return (
    <div className="voice-overlay">
      <div className="voice-overlay-card">
        {state === "listening" && (
          <>
            <div className="voice-mic-pulse">🎙</div>
            <p className="voice-status-text">In ascolto...</p>
          </>
        )}

        {state === "processing" && (
          <>
            <div className="voice-spinner" />
            {transcript && (
              <p className="voice-transcript">"{transcript}"</p>
            )}
            <p className="voice-status-text">Elaborazione in corso...</p>
          </>
        )}

        {state === "speaking" && (
          <>
            {transcript && (
              <p className="voice-transcript">"{transcript}"</p>
            )}
            <div className="voice-answer">
              <p>{answer}</p>
              <span className="voice-cursor" />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VoiceCoachOverlay;
