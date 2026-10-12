// Gemeinsames der Reiter in den Dienstplan-Einstellungen.
import type { SettingsPayload } from "@/lib/roster/settings-service";

export type ShowToast = (message: string) => void;

export type TabProps = { data: SettingsPayload; reload: () => void; showToast: ShowToast };

export async function act(run: () => Promise<unknown>, done: string, reload: () => void, showToast: ShowToast) {
  try {
    await run();
    showToast(done);
    reload();
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
  }
}
