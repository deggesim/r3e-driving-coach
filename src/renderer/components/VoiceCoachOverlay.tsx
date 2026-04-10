/**
 * VoiceCoachOverlay — fixed overlay showing voice interaction state.
 *
 * States:
 *   idle      → hidden
 *   listening → pulsing mic + "In ascolto..."
 *   processing → spinner + transcript
 *   speaking  → streaming answer text
 */

import { Card, Spinner } from "react-bootstrap";
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
    <div
      className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center bg-dark bg-opacity-75"
      style={{ zIndex: 1050 }}
    >
      <Card
        bg="dark"
        border="secondary"
        text="light"
        style={{ minWidth: 320, maxWidth: 480 }}
      >
        <Card.Body className="d-flex flex-column align-items-center gap-3 p-4">
          {state === "listening" && (
            <>
              <div className="voice-mic-pulse fs-1">🎙</div>
              <p className="mb-0 text-secondary">In ascolto...</p>
            </>
          )}

          {state === "processing" && (
            <>
              <Spinner variant="danger" />
              {transcript && (
                <p className="mb-0 fst-italic text-secondary">
                  &ldquo;{transcript}&rdquo;
                </p>
              )}
              <p className="mb-0 text-secondary">Elaborazione in corso...</p>
            </>
          )}

          {state === "speaking" && (
            <>
              {transcript && (
                <p className="mb-0 fst-italic text-secondary">
                  &ldquo;{transcript}&rdquo;
                </p>
              )}
              <div className="text-light">
                <p className="mb-0">{answer}</p>
                <span className="voice-cursor">|</span>
              </div>
            </>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default VoiceCoachOverlay;
