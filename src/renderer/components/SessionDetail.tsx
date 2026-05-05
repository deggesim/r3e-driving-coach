import { Alert } from "react-bootstrap";
import { useSessionStore } from "../store/sessionStore";
import { useFlash } from "../hooks/useFlash";
import { useSetupPicker } from "../hooks/useSetupPicker";
import AceSetupPicker from "./AceSetupPicker";
import AnalysisHeader from "./AnalysisHeader";
import AnalysisList from "./AnalysisList";
import LapsTable from "./LapsTable";
import R3eSetupPicker from "./R3eSetupPicker";
import SetupSelectionModal from "./SetupSelectionModal";

type Props = {
  onBack: () => void;
  onReopened?: () => void;
};

const SessionDetail = ({ onBack, onReopened }: Props) => {
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
  } = useSetupPicker({ session, setups, assignLapSetup, showFlash, explicit: true });

  const handleAnalyze = async (): Promise<void> => {
    if (!session) return;
    const res = await window.electronAPI.sessionAnalyze({
      sessionId: session.id,
      game: session.game,
    });
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

  const handleReopen = async (): Promise<void> => {
    if (!session) return;
    const res = await window.electronAPI.sessionReopen({
      id: session.id,
      game: session.game,
    });
    if (!res.ok) {
      showFlash("danger", (res as { ok: false; reason: string }).reason ?? "Errore nella riapertura");
      return;
    }
    await loadCurrent();
    showFlash("success", "Sessione riaperta.");
    onReopened?.();
  };

  const currentCar = session?.car_name ?? session?.car ?? "";
  const currentTrack = session?.track_name ?? session?.track ?? "";
  const streamingVersion = streaming?.sessionId === session?.id ? streaming : null;
  const sessionActive = !!session && !session.ended_at;

  return (
    <div className="d-flex flex-column h-100 overflow-hidden">
      <AnalysisHeader
        isLive={false}
        sessionActive={sessionActive}
        currentCar={currentCar}
        currentTrack={currentTrack}
        onStart={() => {}}
        onEnd={() => {}}
        onAnalyze={handleAnalyze}
        onExportPdf={handleExportPdf}
        onOpenPicker={() => {
          if (session?.game === "ace") setShowPicker(true);
          else setShowSetupSelection(true);
        }}
        onBack={onBack}
        onReopen={!sessionActive ? handleReopen : undefined}
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

      <div
        className="flex-grow-1 overflow-hidden p-3 d-flex flex-column"
        style={{ minHeight: 0 }}
      >
        <div className="flex-shrink-0">
          <LapsTable setupById={setupById} onPickSetup={setPickerLap} />
        </div>

        <div
          className="flex-grow-1 d-flex flex-column overflow-hidden mt-3"
          style={{ minHeight: 0 }}
        >
          <h6 className="text-uppercase flex-shrink-0">Analisi</h6>
          {analyses.length === 0 && !streamingVersion && (
            <p>Nessuna analisi ancora generata.</p>
          )}
          <AnalysisList streamingVersion={streamingVersion} startClosed />
        </div>
      </div>

      {/* Setup pickers */}
      {session && (
        <>
          {session.game === "ace" ? (
            <AceSetupPicker
              show={showPicker}
              expectedCar={currentCar}
              expectedTrack={currentTrack}
              onClose={() => setShowPicker(false)}
              onConfirm={handleSetupConfirm}
            />
          ) : (
            <R3eSetupPicker
              show={showPicker}
              expectedCar={currentCar}
              onClose={() => setShowPicker(false)}
              onConfirm={handleSetupConfirm}
            />
          )}
          {session.game === "r3e" && (
            <SetupSelectionModal
              show={showSetupSelection}
              car={session.car}
              track={session.track}
              layout={session.layout}
              game={session.game}
              onClose={() => setShowSetupSelection(false)}
              onReuseSetup={handleReuseSetup}
              onJsonPicker={() => {
                setShowSetupSelection(false);
                setShowPicker(true);
              }}
            />
          )}
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
        </>
      )}
    </div>
  );
};

export default SessionDetail;
