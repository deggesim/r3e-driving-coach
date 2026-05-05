import { useState } from "react";

export type FlashState = { variant: string; text: string };

export function useFlash() {
  const [flash, setFlash] = useState<FlashState | null>(null);

  const showFlash = (variant: string, text: string): void => {
    setFlash({ variant, text });
    window.setTimeout(() => setFlash(null), 4000);
  };

  return { flash, setFlash, showFlash };
}
