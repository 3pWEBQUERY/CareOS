"use client";

import type { WitnessInput } from "@/lib/medication-btm-shared";

// Zweitunterschrift für Betäubungsmittel: die zweite Person meldet sich mit eigenem Benutzernamen und
// Passwort an. Der Browser soll die Angaben nicht speichern.
export function WitnessFields({ value, onChange }: { value: WitnessInput; onChange: (value: WitnessInput) => void }) {
  return (
    <fieldset className="btm-witness area-editor-wide">
      <legend>Zweitunterschrift (Betäubungsmittel)</legend>
      <p>Eine zweite berechtigte Person bestätigt die Buchung mit ihrem eigenen Passwort.</p>
      <label>
        <span>Benutzername</span>
        <input
          required
          name="btm-witness-user"
          autoComplete="off"
          value={value.username}
          onChange={(event) => onChange({ ...value, username: event.target.value })}
        />
      </label>
      <label>
        <span>Passwort</span>
        <input
          required
          type="password"
          name="btm-witness-password"
          autoComplete="new-password"
          value={value.password}
          onChange={(event) => onChange({ ...value, password: event.target.value })}
        />
      </label>
    </fieldset>
  );
}

export const emptyWitness: WitnessInput = { username: "", password: "" };
