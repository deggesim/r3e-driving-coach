/**
 * settingsLoader — module-level Promise that loads all persisted config values
 * from SQLite via IPC and applies them to the settingsStore in a single batch.
 *
 * Created once at module-load time (before any component mounts). Because
 * window.electronAPI is injected synchronously by Electron's preload script,
 * it is guaranteed to be available here.
 *
 * The Promise is stable — the same object reference is used for the lifetime
 * of the app, making it safe to pass to React 19's `use()` hook without
 * causing infinite re-suspension.
 */

import { useSettingsStore } from "../store/settingsStore";

const configGet = async (key: string): Promise<string | null> => {
  if (!window.electronAPI) return null;
  const result = (await window.electronAPI.configGet(key)) as
    | { value: string }
    | undefined;
  return result?.value ?? null;
};

export const settingsLoaderPromise: Promise<void> = (async () => {
  const [
    apiKey,
    azureTtsEnabled,
    azureSpeechKey,
    azureRegion,
    azureVoiceName,
    assistantName,
    gamepadButton,
    anthropicModel,
    telemetryLogEnabled,
    keyboardVoiceKey,
    aceSetupsPath,
  ] = await Promise.all([
    configGet("anthropicApiKey"),
    configGet("azureTtsEnabled"),
    configGet("azureSpeechKey"),
    configGet("azureRegion"),
    configGet("azureVoiceName"),
    configGet("assistantName"),
    configGet("gamepadTriggerButton"),
    configGet("anthropicModel"),
    configGet("telemetryLogEnabled"),
    configGet("keyboardVoiceKey"),
    configGet("aceSetupsPath"),
  ]);

  useSettingsStore.getState().initFromConfig({
    apiKey,
    azureTtsEnabled,
    azureSpeechKey,
    azureRegion,
    azureVoiceName,
    assistantName,
    gamepadButton,
    anthropicModel,
    telemetryLogEnabled,
    keyboardVoiceKey,
    aceSetupsPath,
  });
})();
