/**
 * TitleBar — Custom frameless window title bar with tabs and window controls.
 * Used in Electron frameless mode for drag area and window management.
 */

import { Button } from "react-bootstrap";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faMicrophoneSlash,
  faMinus,
  faExpand,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useSettingsStore } from "../store/settingsStore";
import iconUrl from "/icon.png";

type Tab = "current-session" | "session-list" | "settings";

interface TitleBarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TitleBar = ({ tab, onTabChange }: TitleBarProps) => {
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const setTtsEnabled = useSettingsStore((s) => s.setTtsEnabled);
  return (
    <div className="title-bar text-nowrap">
      <img src={iconUrl} className="title-bar-icon" alt="" />
      <span className="title-bar-name">Sim Driving Coach</span>
      <div className="title-bar-tabs">
        <Button
          variant="link"
          className={`tab-btn ${tab === "current-session" ? "active" : ""}`}
          onClick={() => onTabChange("current-session")}
        >
          Analisi in tempo reale
        </Button>
        <Button
          variant="link"
          className={`tab-btn ${tab === "session-list" ? "active" : ""}`}
          onClick={() => onTabChange("session-list")}
        >
          Elenco sessioni
        </Button>
        <Button
          variant="link"
          className={`tab-btn ${tab === "settings" ? "active" : ""}`}
          onClick={() => onTabChange("settings")}
        >
          Impostazioni
        </Button>
      </div>
      <div className="title-bar-tts">
        <Button
          variant="link"
          className={`tts-toggle ${ttsEnabled ? "on" : "off"}`}
          onClick={() => setTtsEnabled(!ttsEnabled)}
          title={ttsEnabled ? "Voce attiva" : "Voce disattiva"}
        >
          {ttsEnabled ? (
            <FontAwesomeIcon icon={faMicrophone} />
          ) : (
            <FontAwesomeIcon icon={faMicrophoneSlash} />
          )}
        </Button>
      </div>
      <Button
        variant="link"
        className="title-bar-wc"
        onClick={() => window.electronAPI.windowMinimize()}
        title="Riduci a icona"
        aria-label="Riduci a icona"
      >
        <FontAwesomeIcon icon={faMinus} />
      </Button>
      <Button
        variant="link"
        className="title-bar-wc"
        onClick={() => window.electronAPI.windowMaximize()}
        title="Ingrandisci"
        aria-label="Ingrandisci finestra"
      >
        <FontAwesomeIcon icon={faExpand} />
      </Button>
      <Button
        variant="link"
        className="title-bar-close"
        onClick={() => window.electronAPI.windowClose()}
        title="Chiudi"
        aria-label="Chiudi finestra"
      >
        <FontAwesomeIcon icon={faXmark} />
      </Button>
    </div>
  );
};

export default TitleBar;
