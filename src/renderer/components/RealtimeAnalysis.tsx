/**
 * RealtimeAnalysis — real-time session analysis panel.
 *
 * Top: session header with action buttons
 *   [Nuova sessione] [Chiudi sessione] [Carica setup] [Esegui analisi] [Esporta PDF]
 * Middle: laps table
 * Bottom: Accordion of session analyses (alwaysOpen; streaming placeholder when running)
 *
 * Supports both live session (mode="live") and historical (mode="historical", read-only
 * lifecycle; analyze + export PDF still enabled).
 */

import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-bootstrap";
import type { SetupData } from "../../shared/types";
import { useIPCStore } from "../store/ipcStore";
import { useSessionStore } from "../store/sessionStore";
import AceSetupPicker from "./AceSetupPicker";
import AnalysisHeader from "./AnalysisHeader";
import AnalysisList from "./AnalysisList";
import LapsTable from "./LapsTable";
import R3eSetupPicker from "./R3eSetupPicker";
import SetupSelectionModal from "./SetupSelectionModal";

const RealtimeAnalysis = () => {
  const status = useIPCStore((s) => s.status);

  const session = useSessionStore((s) => s.session);
  const setups = useSessionStore((s) => s.setups);
  const analyses = useSessionStore((s) => s.analyses);
  const streaming = useSessionStore((s) => s.streaming);
  const loadCurrent = useSessionStore((s) => s.loadCurrent);

  const [showPicker, setShowPicker] = useState(false);
  const [showSetupSelection, setShowSetupSelection] = useState(false);
  const [flash, setFlash] = useState<{ variant: string; text: string } | null>(
    null,
  );

  useEffect(() => {
    void loadCurrent();
  }, [loadCurrent]);

  const isLive = true;
  const sessionActive = !!session && !session.ended_at;

  const showFlash = (variant: string, text: string): void => {
    setFlash({ variant, text });
    window.setTimeout(() => setFlash(null), 4000);
  };

  const handleStart = async (): Promise<void> => {
    const res = await window.electronAPI.sessionStart();
    if (!res.ok) {
      showFlash("danger", res.reason);
    } else {
      showFlash("success", "Sessione aperta.");
      if (status.game === "r3e") {
        setShowSetupSelection(true);
      }
    }
  };

  const handleEnd = async (): Promise<void> => {
    await window.electronAPI.sessionEnd();
    showFlash("secondary", "Sessione chiusa.");
  };

  const handleAnalyze = async (): Promise<void> => {
    if (!session) return;
    const res = await window.electronAPI.sessionAnalyze({});
    if (!res.ok) showFlash("danger", res.reason ?? "Errore durante l'analisi");
    else showFlash("info", "Analisi in corso…");
  };

  const handleExportPdf = async (): Promise<void> => {
    if (!session) return;
    const path = await window.electronAPI.sessionExportPdf({
      id: session.id,
      game: session.game,
    });
    if (path) showFlash("success", `PDF salvato: ${path}`);
  };

  const handleSetupConfirm = async (setup: SetupData): Promise<void> => {
    setShowPicker(false);
    try {
      const named: SetupData = setup.name
        ? setup
        : { ...setup, name: setup.carFound || "Setup" };
      await window.electronAPI.sessionLoadSetup({ setup: named });
      showFlash("success", `Setup caricato: ${named.name}`);
    } catch (err) {
      showFlash("danger", String(err));
    }
  };

  const handleReuseSetup = async (setupId: number): Promise<void> => {
    setShowSetupSelection(false);
    try {
      await window.electronAPI.sessionReuseSetup({ setupId });
      showFlash("success", "Setup attivo aggiornato.");
    } catch (err) {
      showFlash("danger", String(err));
    }
  };

  const currentCar = session?.car_name ?? session?.car ?? status?.car ?? "";
  const currentTrack =
    session?.track_name ?? session?.track ?? status?.track ?? "";

  const setupById = useMemo(() => {
    const m = new Map<number, (typeof setups)[0]>();
    setups.forEach((s) => m.set(s.id, s));
    return m;
  }, [setups]);

  const streamingVersion =
    streaming?.sessionId === session?.id ? streaming : null;

  return (
    <div className="d-flex flex-column h-100 overflow-hidden">
      {/* Header */}
      <AnalysisHeader
        isLive={isLive}
        sessionActive={sessionActive}
        currentCar={currentCar}
        currentTrack={currentTrack}
        onStart={handleStart}
        onEnd={handleEnd}
        onAnalyze={handleAnalyze}
        onExportPdf={handleExportPdf}
        onOpenPicker={
          status.game === "r3e"
            ? () => setShowSetupSelection(true)
            : () => setShowPicker(true)
        }
      />

      {flash && (
        <Alert
          variant={flash.variant}
          onClose={() => setFlash(null)}
          dismissible
          className="mb-0"
        >
          {flash.text}
        </Alert>
      )}

      {/* Body: laps table (fixed height) + analyses section (scrollable) */}
      <div className="flex-grow-1 overflow-hidden p-3 d-flex flex-column" style={{ minHeight: 0 }}>
        <div className="flex-shrink-0">
          <LapsTable setupById={setupById} live />
        </div>

        <div className="flex-grow-1 d-flex flex-column overflow-hidden mt-3" style={{ minHeight: 0 }}>
          <h6 className="text-uppercase flex-shrink-0">Analisi</h6>
          {analyses.length === 0 && !streamingVersion && (
            <p>Nessuna analisi ancora generata.</p>
          )}
          <AnalysisList streamingVersion={streamingVersion} />
        </div>
      </div>

      {/* Setup pickers */}
      {status.game === "ace" ? (
        <AceSetupPicker
          show={showPicker}
          expectedCar={currentCar}
          expectedTrack={currentTrack}
          onClose={() => setShowPicker(false)}
          onConfirm={handleSetupConfirm}
        />
      ) : (
        <>
          <R3eSetupPicker
            show={showPicker}
            expectedCar={currentCar}
            onClose={() => setShowPicker(false)}
            onConfirm={handleSetupConfirm}
          />
          {session && (
            <SetupSelectionModal
              show={showSetupSelection}
              car={session.car}
              track={session.track}
              layout={session.layout}
              game="r3e"
              onClose={() => setShowSetupSelection(false)}
              onReuseSetup={handleReuseSetup}
              onJsonPicker={() => {
                setShowSetupSelection(false);
                setShowPicker(true);
              }}
            />
          )}
        </>
      )}
    </div>
  );
};

export default RealtimeAnalysis;
