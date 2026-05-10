import { useCallback, useRef, useState } from "react";

export type FlashState = { variant: string; text: string };

export function useFlash() {
  const [flash, setFlash] = useState<FlashState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFlash = useCallback((variant: string, text: string): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setFlash({ variant, text });
    timerRef.current = setTimeout(() => setFlash(null), 4000);
  }, []);

  return { flash, setFlash, showFlash };
}
