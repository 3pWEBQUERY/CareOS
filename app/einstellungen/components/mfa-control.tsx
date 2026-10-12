"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { requestJson } from "@/app/components/workspace-ui";

type Status = { available: boolean; enabled: boolean; pending: boolean; recoveryRemaining: number };
type Enrollment = { secret: string; uri: string; qr: string };

// Zwei-Faktor-Anmeldung (Authenticator-App): einrichten, Wiederherstellungscodes, ausschalten.
// onChanged lädt die Einstellungen neu (Anzeige „Ein/Aus“); erst nach dem Notieren der Codes, damit sie sichtbar bleiben.
export default function MfaControl({
  onMessage,
  onChanged,
}: {
  onMessage: (message: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    requestJson<Status>("/api/me/mfa").then(
      (next) => live && setStatus(next),
      (cause: Error) => live && setError(cause.message),
    );
    return () => {
      live = false;
    };
  }, [version]);

  const run = async <T,>(action: string, success: string, done: (result: T) => void) => {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<T>("/api/me/mfa", { method: "POST", body: { action, code } });
      setCode("");
      done(result);
      if (success) onMessage(success);
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const codeField = (label: string) => (
    <label className="settings-mfa-code">
      <span>{label}</span>
      <input
        inputMode="text"
        autoComplete="one-time-code"
        maxLength={12}
        value={code}
        onChange={(event) => setCode(event.target.value)}
      />
    </label>
  );

  if (!status) return <p aria-live="polite">{error || "Wird geladen …"}</p>;
  if (codes)
    return (
      <div className="settings-mfa">
        <p>
          <strong>Wiederherstellungscodes – jetzt sicher aufbewahren.</strong> Jeder Code gilt einmal, falls das Handy
          nicht zur Hand ist. Sie werden nur jetzt angezeigt.
        </p>
        <ul className="settings-mfa-codes" aria-label="Wiederherstellungscodes">
          {codes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setCodes(null);
            onChanged();
          }}
        >
          Codes sind notiert
        </button>
      </div>
    );
  if (!status.available)
    return (
      <p aria-live="polite">
        Auf diesem Server ist die Zwei-Faktor-Anmeldung noch nicht eingerichtet. Die Administration hinterlegt dafür den
        Schlüssel CARECORE_MFA_KEY.
      </p>
    );
  if (status.enabled)
    return (
      <div className="settings-mfa">
        <p>
          Eingeschaltet. Bei der Anmeldung fragt CareOS nach dem Code aus der Authenticator-App. Noch{" "}
          {status.recoveryRemaining} Wiederherstellungscodes übrig.
        </p>
        {codeField("Aktueller Code aus der App")}
        {error && <p role="alert">{error}</p>}
        <div className="settings-action">
          <button
            className="secondary-button"
            type="button"
            disabled={busy || !code.trim()}
            onClick={() =>
              void run<{ recoveryCodes: string[] }>("recovery", "Neue Wiederherstellungscodes erstellt", (result) =>
                setCodes(result.recoveryCodes),
              )
            }
          >
            Neue Wiederherstellungscodes
          </button>
          <button
            className="secondary-button danger"
            type="button"
            disabled={busy || !code.trim()}
            onClick={() => void run("disable", "Zwei-Faktor-Anmeldung ausgeschaltet", onChanged)}
          >
            Ausschalten
          </button>
        </div>
      </div>
    );
  if (enrollment)
    return (
      <div className="settings-mfa">
        <p>
          1. Den QR-Code mit einer Authenticator-App scannen (z. B. Microsoft oder Google Authenticator) – oder den
          Schlüssel von Hand eingeben.
        </p>
        <div className="settings-mfa-setup">
          <Image src={enrollment.qr} alt="QR-Code für die Authenticator-App" width={176} height={176} unoptimized />
          <code aria-label="Schlüssel zum Abtippen">{enrollment.secret}</code>
        </div>
        <p>2. Den angezeigten 6-stelligen Code eingeben.</p>
        {codeField("Code aus der App")}
        {error && <p role="alert">{error}</p>}
        <div className="settings-action">
          <button
            className="primary-button"
            type="button"
            disabled={busy || code.trim().length < 6}
            onClick={() =>
              void run<{ recoveryCodes: string[] }>("confirm", "Zwei-Faktor-Anmeldung eingeschaltet", (result) => {
                setEnrollment(null);
                setCodes(result.recoveryCodes);
              })
            }
          >
            Bestätigen und einschalten
          </button>
        </div>
      </div>
    );
  return (
    <div className="settings-mfa">
      <p>Ausgeschaltet. Mit einer Authenticator-App auf dem Handy wird die Anmeldung zusätzlich geschützt.</p>
      {error && <p role="alert">{error}</p>}
      <div className="settings-action">
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => void run<Enrollment>("start", "", setEnrollment)}
        >
          Einrichten
        </button>
      </div>
    </div>
  );
}
