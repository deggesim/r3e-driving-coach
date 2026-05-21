import { Alert } from "react-bootstrap";
import { useFlash } from "../hooks/useFlash";
import { useSetupPicker } from "../hooks/useSetupPicker";
import { useIPCStore } from "../store/ipcStore";
import { useSessionStore } from "../store/sessionStore";
import AceSetupPicker from "./AceSetupPicker";
import AnalysisHeader from "./AnalysisHeader";
import AnalysisList from "./AnalysisList";
import LapsTable from "./LapsTable";
import R3eSetupPicker from "./R3eSetupPicker";
import SetupSelectionModal from "./SetupSelectionModal";

type Props = {
  mode: "live" | "historical";
  onSessionClosed?: () => void;
  onBack?: () => void;
  onReopened?: () => void;
};

const SessionPanel = ({ mode, onSessionClosed, onBack, onReopened }: Props) => {
  const status = useIPCStore((s) => s.status);
  const session = useSessionStore((s) => s.session);
  const analyses = useSessionStore((s) => s.analyses);
  const streaming = useSessionStore((s) => s.streaming);
  const loadCurrent = useSessionStore((s) => s.loadCurrent);

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
  } = useSetupPicker({ showFlash, explicit: mode === "historical" });

  const game = session?.game ?? (mode === "live" ? status.game : undefined);
  const currentCar =
    session?.car_name ??
    session?.car ??
    (mode === "live" ? status?.car : undefined) ??
    "";
  const currentTrack =
    session?.track_name ??
    session?.track ??
    (mode === "live" ? status?.track : undefined) ??
    "";
  const streamingVersion =
    streaming?.sessionId === session?.id ? streaming : null;
  const sessionActive = !!session && !session.ended_at;
  const isLive = mode === "live";

  const handleStart = async (): Promise<void> => {
    const res = await window.electronAPI.sessionStart();
    if (!res.ok) {
      showFlash("danger", res.reason);
    } else {
      showFlash("success", "Sessione aperta.");
      if (status.game === "r3e") setShowSetupSelection(true);
    }
  };

  const handleEnd = async (): Promise<void> => {
    await window.electronAPI.sessionEnd();
    onSessionClosed?.();
  };

  const handleReopen = async (): Promise<void> => {
    if (!session) return;
    const res = await window.electronAPI.sessionReopen({
      id: session.id,
      game: session.game,
    });
    if (!res.ok) {
      showFlash(
        "danger",
        (res as { ok: false; reason: string }).reason ??
          "Errore nella riapertura",
      );
      return;
    }
    await loadCurrent();
    showFlash("success", "Sessione riaperta.");
    onReopened?.();
  };

  const handleAnalyze = async (flags: {
    leaderboardMode: boolean;
    fixedSetup: boolean;
  }): Promise<void> => {
    if (!session) return;
    const res = await window.electronAPI.sessionAnalyze(
      mode === "historical"
        ? { sessionId: session.id, game: session.game, ...flags }
        : { ...flags },
    );
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

  return (
    <div className="d-flex flex-column h-100 overflow-hidden">
      <AnalysisHeader
        isLive={isLive}
        sessionActive={sessionActive}
        currentCar={currentCar}
        currentTrack={currentTrack}
        onStart={isLive ? handleStart : () => {}}
        onEnd={isLive ? handleEnd : () => {}}
        onAnalyze={handleAnalyze}
        onExportPdf={handleExportPdf}
        onOpenPicker={
          game === "r3e"
            ? () => setShowSetupSelection(true)
            : () => setShowPicker(true)
        }
        onBack={!isLive ? onBack : undefined}
        onReopen={!isLive && !sessionActive ? handleReopen : undefined}
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
          <LapsTable
            setupById={setupById}
            live={isLive}
            onPickSetup={setPickerLap}
          />
        </div>

        <div
          className="flex-grow-1 d-flex flex-column overflow-hidden mt-3"
          style={{ minHeight: 0 }}
        >
          <h6 className="text-uppercase flex-shrink-0">Analisi</h6>
          {analyses.length === 0 && !streamingVersion && (
            <p>Nessuna analisi ancora generata.</p>
          )}
          <AnalysisList
            streamingVersion={streamingVersion}
            startClosed={!isLive}
          />
        </div>
      </div>

      {/* Setup pickers */}
      {game === "ace" ? (
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

      {session?.game === "r3e" && (
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

export default SessionPanel;
