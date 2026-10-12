"use client";

import { useState, type FormEvent } from "react";
import { EnvelopeSimple, User } from "@phosphor-icons/react";

// „Passwort vergessen“ auf der Anmeldeseite: Link an die hinterlegte E-Mail-Adresse anfordern.
export function ForgotPasswordForm({ initial, onBack }: { initial: string; onBack: () => void }) {
  const [identifier, setIdentifier] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Die Anfrage ist derzeit nicht möglich.");
      setSent(data.message ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Anfrage ist derzeit nicht möglich.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="login-heading">
        <p className="eyebrow">Passwort vergessen</p>
        <h2>Neues Passwort anfordern</h2>
        <p>Wir senden dir einen Link an die E-Mail-Adresse, die bei deinem Konto hinterlegt ist.</p>
      </div>
      {sent ? (
        <div className="login-form">
          <div className="login-notice" role="status">
            <EnvelopeSimple />
            <span>{sent}</span>
          </div>
          <button className="login-submit" type="button" onClick={onBack}>
            Zurück zur Anmeldung
          </button>
        </div>
      ) : (
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="reset-identifier">Benutzername oder E-Mail</label>
          <div className="login-input">
            <User />
            <input
              id="reset-identifier"
              name="identifier"
              autoComplete="username"
              autoFocus
              maxLength={200}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="Benutzername oder E-Mail-Adresse"
              required
            />
          </div>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
          <button className="login-submit" type="submit" disabled={pending}>
            {pending ? (
              <>
                <span className="login-spinner" />
                Wird gesendet …
              </>
            ) : (
              <>
                Link senden <span aria-hidden="true">→</span>
              </>
            )}
          </button>
          <p className="login-mfa-hint">
            <button type="button" onClick={onBack}>
              Zurück zur Anmeldung
            </button>
          </p>
        </form>
      )}
    </>
  );
}
