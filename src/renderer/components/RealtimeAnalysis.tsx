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

import { use, useMemo } from "react";
import { Alert } from "react-bootstrap";
import { useIPCStore } from "../store/ipcStore";
import { useSessionStore } from "../store/sessionStore";
import { useFlash } from "../hooks/useFlash";
import { useSetupPicker } from "../hooks/useSetupPicker";
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
  const assignLapSetup = useSessionStore((s) => s.assignLapSetup);

  const { flash, setFlash, showFlash } = useFlash();
  const {
    showPicker,
    setShowPicker,
    showSetupSelection,
    setShowSetupSelection,
    pickerLap,
    setPickerLap,
    setPendingLapId,
    setupById,
    handleSetupConfirm,
    handleReuseSetup,
    handleLapReuseSetup,
  } = useSetupPicker({ session, setups, assignLapSetup, showFlash });

  // Load current session data on mount. useMemo creates the Promise once per
  // component mount (empty deps), use() suspends until it resolves. The parent
  // Suspense boundary in App.tsx handles the loading state.
  const loadPromise = useMemo(() => loadCurrent(), []);
  use(loadPromise);

  const isLive = true;
  const sessionActive = !!session && !session.ended_at;

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

  const handleAnalyze = async (flags: {
    leaderboardMode: boolean;
    fixedSetup: boolean;
  }): Promise<void> => {
    if (!session) return;
    const res = await window.electronAPI.sessionAnalyze({ ...flags });
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

  const currentCar = session?.car_name ?? session?.car ?? status?.car ?? "";
  const currentTrack =
    session?.track_name ?? session?.track ?? status?.track ?? "";

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
          (session?.game ?? status.game) === "r3e"
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
      <div
        className="flex-grow-1 overflow-hidden p-3 d-flex flex-column"
        style={{ minHeight: 0 }}
      >
        <div className="flex-shrink-0">
          <LapsTable setupById={setupById} live onPickSetup={setPickerLap} />
        </div>

        <div
          className="flex-grow-1 d-flex flex-column overflow-hidden mt-3"
          style={{ minHeight: 0 }}
        >
          <h6 className="text-uppercase flex-shrink-0">Analisi</h6>
          {analyses.length === 0 && !streamingVersion && (
            <p>Nessuna analisi ancora generata.</p>
          )}
          <AnalysisList streamingVersion={streamingVersion} />
        </div>
      </div>

      {/* Setup pickers */}
      {(session?.game ?? status.game) === "ace" ? (
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
      {session && (
        <SetupSelectionModal
          show={pickerLap != null}
          car={session.car}
          track={session.track}
          layout={session.layout}
          game={session.game}
          onClose={() => setPickerLap(null)}
          onReuseSetup={handleLapReuseSetup}
          onJsonPicker={() => {
            setPendingLapId(pickerLap!.id);
            setPickerLap(null);
            setShowPicker(true);
          }}
        />
      )}
    </div>
  );
};

export default RealtimeAnalysis;
