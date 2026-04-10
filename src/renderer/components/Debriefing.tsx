/**
 * Debriefing — Post-lap panel.
 *
 * States: idle ("In attesa del giro..."), loading ("Analisi in corso..."), result (Template v3).
 * Layout: header with lap info, body with Template v3 rendered, footer with PDF export button.
 */

import { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import type { LapRecord, LapAnalysis } from '../../shared/types';

type DebriefingProps = {
  lastLap: LapRecord | null;
  lastAnalysis: LapAnalysis | null;
};

type DebriefingState = 'idle' | 'loading' | 'result';

const formatLapTime = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0
    ? `${mins}:${secs.toFixed(3).padStart(6, '0')}`
    : `${secs.toFixed(3)}s`;
};

const Debriefing = ({ lastLap, lastAnalysis }: DebriefingProps) => {
  const [state, setState] = useState<DebriefingState>('idle');
  const [displayedAnalysis, setDisplayedAnalysis] = useState<LapAnalysis | null>(null);
  const [displayedLap, setDisplayedLap] = useState<LapRecord | null>(null);
  const lastLapRef = useRef<LapRecord | null>(null);
  const lastAnalysisRef = useRef<LapAnalysis | null>(null);

  // New lap arrived → show loading
  useEffect(() => {
    if (!lastLap || lastLap === lastLapRef.current) return;
    lastLapRef.current = lastLap;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setDisplayedLap(lastLap);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setState('loading');
  }, [lastLap]);

  // Analysis arrived → show result
  useEffect(() => {
    if (!lastAnalysis || lastAnalysis === lastAnalysisRef.current) return;
    lastAnalysisRef.current = lastAnalysis;
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setDisplayedAnalysis(lastAnalysis);
    // eslint-disable-next-line @eslint-react/set-state-in-effect
    setState('result');
  }, [lastAnalysis]);

  const renderMarkdown = (md: string): string => {
    return marked.parse(md, { async: false }) as string;
  };

  const deltaLabel = (): string => {
    if (!displayedLap || !displayedAnalysis) return '';
    // We don't have reference lap time here, just show lap time
    return formatLapTime(displayedLap.lapTime);
  };

  return (
    <div className="debriefing">
      {/* Header */}
      <div className="debriefing-header">
        {displayedLap ? (
          <>
            <span className="deb-car">{displayedLap.car}</span>
            <span className="deb-sep">·</span>
            <span className="deb-track">{displayedLap.track} {displayedLap.layout}</span>
            <span className="deb-sep">·</span>
            <span className="deb-time">Giro {displayedLap.lapNumber}: {deltaLabel()}</span>
            {!displayedLap.valid && <span className="deb-invalid">⚠ Non valido</span>}
          </>
        ) : (
          <span className="deb-placeholder">Nessun giro registrato</span>
        )}
      </div>

      {/* Body */}
      <div className="debriefing-body">
        {state === 'idle' && (
          <div className="deb-idle">In attesa del giro...</div>
        )}

        {state === 'loading' && (
          <div className="deb-loading">
            <div className="deb-spinner" />
            <span>Analisi in corso...</span>
          </div>
        )}

        {state === 'result' && displayedAnalysis && (
          <div
            className="deb-content"
            // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(displayedAnalysis.templateV3),
            }}
          />
        )}
      </div>

      {/* Footer */}
      {state === 'result' && displayedAnalysis && (
        <div className="debriefing-footer">
          <span className="deb-generated">
            Generato: {new Date(displayedAnalysis.generatedAt).toLocaleTimeString('it-IT')}
          </span>
        </div>
      )}
    </div>
  );
};

export default Debriefing;
