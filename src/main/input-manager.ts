import { globalShortcut } from "electron";

// Converts the stored key format (JS event.key + modifier prefixes joined by "+")
// to an Electron accelerator string.
const toAccelerator = (key: string): string => {
  const parts = key.split("+");
  const lastIdx = parts.length - 1;
  return parts
    .map((part, i) => {
      if (i < lastIdx) return part; // modifier prefix: Ctrl, Alt, Shift — unchanged
      switch (part) {
        case " ":         return "Space";
        case "ArrowUp":   return "Up";
        case "ArrowDown": return "Down";
        case "ArrowLeft": return "Left";
        case "ArrowRight":return "Right";
        case "Enter":     return "Return";
        default:
          return part.length === 1 ? part.toUpperCase() : part;
      }
    })
    .join("+");
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
