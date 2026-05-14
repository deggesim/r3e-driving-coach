import { globalShortcut } from "electron";

const MODIFIER_PREFIXES = ["Ctrl", "Alt", "Shift", "Meta"];

const mapKeyPart = (key: string): string => {
  switch (key) {
    case " ":          return "Space";
    case "+":          return "Plus";
    case "ArrowUp":    return "Up";
    case "ArrowDown":  return "Down";
    case "ArrowLeft":  return "Left";
    case "ArrowRight": return "Right";
    case "Enter":      return "Return";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
};

// Converts the stored key format (JS event.key + modifier prefixes joined by "+")
// to an Electron accelerator string. Parses modifiers greedily to avoid ambiguity
// when the actual key character is "+".
const toAccelerator = (key: string): string => {
  const modifiers: string[] = [];
  let remaining = key;
  let changed = true;
  while (changed) {
    changed = false;
    for (const mod of MODIFIER_PREFIXES) {
      if (remaining.startsWith(mod + "+")) {
        modifiers.push(mod);
        remaining = remaining.slice(mod.length + 1);
        changed = true;
        break;
      }
    }
  }
  return [...modifiers, mapKeyPart(remaining)].join("+");
};

export type InputManager = {
  setKeyboard: (key: string | null) => void;
  destroy: () => void;
};

export const createInputManager = (onTrigger: () => void): InputManager => {
  if (process.platform !== "win32") {
    return { setKeyboard: () => {}, destroy: () => {} };
  }

  let currentAccelerator: string | null = null;

  const setKeyboard = (key: string | null): void => {
    if (currentAccelerator) {
      try { globalShortcut.unregister(currentAccelerator); } catch { /* ignore */ }
      currentAccelerator = null;
    }
    if (!key) return;

    const accelerator = toAccelerator(key);
    try {
      const ok = globalShortcut.register(accelerator, onTrigger);
      if (ok) {
        currentAccelerator = accelerator;
        console.log(`[InputManager] Registered shortcut: ${accelerator}`);
      } else {
        console.warn(`[InputManager] Shortcut already taken: ${accelerator}`);
      }
    } catch (err) {
      console.error(`[InputManager] Failed to register ${accelerator}:`, err);
    }
  };

  const destroy = (): void => {
    if (currentAccelerator) {
      try { globalShortcut.unregister(currentAccelerator); } catch { /* ignore */ }
      currentAccelerator = null;
    }
  };

  return { setKeyboard, destroy };
};
