import { useMemo, useState } from "react";
import type { LapRow, SessionSetupRow, SetupData } from "../../shared/types";
import { useSessionStore } from "../store/sessionStore";

type Options = {
  showFlash: (variant: string, text: string) => void;
  /** When true, passes sessionId+game explicitly to sessionLoadSetup (used in SessionDetail) */
  explicit?: boolean;
};

export const useSetupPicker = ({ showFlash, explicit }: Options) => {
  const session = useSessionStore((s) => s.session);
  const setups = useSessionStore((s) => s.setups);
  const assignLapSetup = useSessionStore((s) => s.assignLapSetup);
  const [showPicker, setShowPicker] = useState(false);
  const [showSetupSelection, setShowSetupSelection] = useState(false);
  const [pickerLap, setPickerLap] = useState<LapRow | null>(null);
  const [pendingLapId, setPendingLapId] = useState<number | null>(null);

  const setupById = useMemo(() => {
    const m = new Map<number, SessionSetupRow>();
    setups.forEach((s) => m.set(s.id, s));
    return m;
  }, [setups]);

  const handleSetupConfirm = async (setup: SetupData): Promise<void> => {
    setShowPicker(false);
    if (explicit) setShowSetupSelection(false);
    if (explicit && !session) return;
    try {
      const named: SetupData = setup.name
        ? setup
        : { ...setup, name: setup.carFound || "Setup" };
      const params =
        explicit && session
          ? { setup: named, sessionId: session.id, game: session.game }
          : { setup: named };
      const { setupId } = await window.electronAPI.sessionLoadSetup(params);
      if (pendingLapId != null) {
        await assignLapSetup(pendingLapId, setupId);
        setPendingLapId(null);
        showFlash("success", `Setup ${named.name} caricato e assegnato al giro.`);
      } else {
        showFlash("success", `Setup caricato: ${named.name}`);
      }
    } catch (err) {
      showFlash("danger", String(err));
    }
  };

  const handleReuseSetup = async (row: SessionSetupRow): Promise<void> => {
    setShowSetupSelection(false);
    try {
      if (explicit && session) {
        if (setupById.has(row.id)) {
          showFlash("success", "Setup già presente nella sessione.");
          return;
        }
        const named: SetupData = row.setup.name
          ? row.setup
          : { ...row.setup, name: row.setup.carFound || "Setup" };
        await window.electronAPI.sessionLoadSetup({
          setup: named,
          sessionId: session.id,
          game: session.game,
        });
        showFlash("success", `Setup caricato: ${named.name}`);
      } else if (!explicit) {
        let targetSetupId = row.id;
        if (!setupById.has(row.id)) {
          // Setup from another session: copy it to the current session so the counter
          // reflects it and future laps link to a row owned by this session.
          const named: SetupData = row.setup.name
            ? row.setup
            : { ...row.setup, name: row.setup.carFound || "Setup" };
          const result = await window.electronAPI.sessionLoadSetup({ setup: named });
          targetSetupId = result.setupId;
        }
        await window.electronAPI.sessionReuseSetup({ setupId: targetSetupId });
        showFlash("success", "Setup attivo aggiornato.");
      }
    } catch (err) {
      showFlash("danger", String(err));
    }
  };

  const handleLapReuseSetup = async (row: SessionSetupRow): Promise<void> => {
    const lapId = pickerLap?.id;
    if (lapId == null) return;
    try {
      let targetSetupId = row.id;
      // If the setup is not in the current session, copy it first so setup_id
      // resolves correctly in setupById and persists on reload.
      if (!setupById.has(row.id)) {
        const named: SetupData = row.setup.name
          ? row.setup
          : { ...row.setup, name: row.setup.carFound || "Setup" };
        const params =
          explicit && session
            ? { setup: named, sessionId: session.id, game: session.game }
            : { setup: named };
        const result = await window.electronAPI.sessionLoadSetup(params);
        targetSetupId = result.setupId;
      }
      await assignLapSetup(lapId, targetSetupId);
      showFlash("success", "Setup assegnato al giro.");
    } catch (err) {
      showFlash("danger", String(err));
    }
  };

  return {
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
  };
}
