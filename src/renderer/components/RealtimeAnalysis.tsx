import { use, useMemo } from "react";
import { useSessionStore } from "../store/sessionStore";
import SessionPanel from "./SessionPanel";

const RealtimeAnalysis = ({
  onSessionClosed,
}: {
  onSessionClosed?: () => void;
}) => {
  const loadCurrent = useSessionStore((s) => s.loadCurrent);
  // eslint-disable-next-line @eslint-react/exhaustive-deps
  const loadPromise = useMemo(() => loadCurrent(), []);
  use(loadPromise);
  return <SessionPanel mode="live" onSessionClosed={onSessionClosed} />;
};

export default RealtimeAnalysis;
