import { useMemo, useState } from "react";
import { Alert } from "react-bootstrap";
import { useSessionStore } from "../store/sessionStore";
import AnalysisHeader from "./AnalysisHeader";
import AnalysisList from "./AnalysisList";
import LapsTable from "./LapsTable";

type Props = {
  onBack: () => void;
};

const SessionDetail = ({ onBack }: Props) => {
  const session = useSessionStore((s) => s.session);
  const setups = useSessionStore((s) => s.setups);
  const analyses = useSessionStore((s) => s.analyses);
  const streaming = useSessionStore((s) => s.streaming);

  const [flash, setFlash] = useState<{ variant: string; text: string } | null>(
    null,
  );

  const showFlash = (variant: string, text: string): void => {
    setFlash({ variant, text });
    window.setTimeout(() => setFlash(null), 4000);
  };

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

  const currentCar = session?.car_name ?? session?.car ?? "";
  const currentTrack = session?.track_name ?? session?.track ?? "";

  const setupById = useMemo(() => {
    const m = new Map<number, string>(); // setup.id → display name
    setups.forEach((s, i) => m.set(s.id, s.setup.name ?? `#${i + 1}`));
    return m;
  }, [setups]);

  const streamingVersion =
    streaming?.sessionId === session?.id ? streaming : null;

  return (
    <div className="d-flex flex-column h-100 overflow-hidden">
      <AnalysisHeader
        isLive={false}
        sessionActive={false}
        currentCar={currentCar}
        currentTrack={currentTrack}
        onStart={() => {}}
        onEnd={() => {}}
        onAnalyze={handleAnalyze}
        onExportPdf={handleExportPdf}
        onOpenPicker={() => {}}
        onBack={onBack}
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
          <LapsTable setupById={setupById} />
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
    </div>
  );
};

export default SessionDetail;
