import { useState } from "react";
import { Nav } from "react-bootstrap";
import type { SetupParam } from "../../shared/types";

const ACE_TAB_ORDER = [
  "Pneumatici",
  "Elettronica",
  "Carburante e Strategia",
  "Sospensioni",
  "Ammortizzatori",
  "Aerodinamica",
] as const;
type AceTabId = (typeof ACE_TAB_ORDER)[number];

const WHEEL_KEYS = ["FL", "FR", "RL", "RR"] as const;
type WheelKey = (typeof WHEEL_KEYS)[number];

const WHEEL_LABELS: Record<WheelKey, string> = {
  FL: "Ant. Sinistro",
  FR: "Ant. Destro",
  RL: "Post. Sinistro",
  RR: "Post. Destro",
};

function getAceTab(p: SetupParam): AceTabId {
  switch (p.category) {
    case "Pneumatici":
    case "Geometria":
      return "Pneumatici";
    case "Elettronica":
      return "Elettronica";
    case "Carburante":
    case "Identificazione":
      return "Carburante e Strategia";
    case "Sospensioni":
    case "Sterzo":
    case "Freni":
      return "Sospensioni";
    case "Ammortizzatori":
      return "Ammortizzatori";
    case "Aerodinamica":
    case "Assetto":
      return "Aerodinamica";
    default:
      return "Aerodinamica";
  }
}

function getWheelKey(parameter: string): WheelKey | null {
  for (const key of WHEEL_KEYS) {
    if (new RegExp(`\\s${key}(\\s|$)`).test(parameter)) return key;
  }
  return null;
}

function stripWheelSuffix(parameter: string): string {
  return parameter.replace(/\s+(FL|FR|RL|RR)(?=\s|$)/, "").trim();
}
