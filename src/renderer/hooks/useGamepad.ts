/**
 * useGamepad — polls the Gamepad API and fires onButtonPress when a configured button
 * transitions from released to pressed.
 *
 * Uses setInterval at 100ms to keep CPU usage minimal.
 */

import { useEffect, useRef } from "react";

type UseGamepadOptions = {
  buttonIndex: number;       // which button to watch (0 = A on Xbox)
  onButtonPress: () => void;
  enabled?: boolean;
};

export const useGamepad = ({
  buttonIndex,
  onButtonPress,
  enabled = true,
}: UseGamepadOptions): void => {
  // Track the previous pressed state to detect transitions
  const prevPressedRef = useRef<boolean>(false);
  const onButtonPressRef = useRef(onButtonPress);
  onButtonPressRef.current = onButtonPress;

  useEffect(() => {
    if (!enabled) return;

    const poll = () => {
      const gamepads = navigator.getGamepads();
      for (const gp of gamepads) {
        if (!gp) continue;
        const button = gp.buttons[buttonIndex];
        if (!button) continue;
        const pressed = button.pressed;
        if (pressed && !prevPressedRef.current) {
          onButtonPressRef.current();
        }
        prevPressedRef.current = pressed;
        break; // only watch the first connected gamepad
      }
    };

    const id = setInterval(poll, 100);
    return () => clearInterval(id);
  }, [enabled, buttonIndex]);
};
