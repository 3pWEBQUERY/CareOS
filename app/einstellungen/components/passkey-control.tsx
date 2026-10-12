"use client";

import { useEffect, useState } from "react";
import { startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { ModuleIcon } from "@/app/components/module-icon";
import { formatDateTime, requestJson } from "@/app/components/workspace-ui";
import type { PasskeySummary } from "@/lib/passkeys";

// Passkeys: auf diesem Gerät hinzufügen, gespeicherte ansehen und entfernen.
export default function PasskeyControl({
  onMessage,
  onChanged,
}: {
  onMessage: (message: string) => void;
  onChanged: () => void;
}) {
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const supported = typeof window !== "undefined" && "PublicKeyCredential" in window;

  useEffect(() => {
    let live = true;
    requestJson<{ passkeys: PasskeySummary[] }>("/api/me/passkeys").then(
      (result) => live && setPasskeys(result.passkeys),
      (cause: Error) => live && setError(cause.message),
    );
    return () => {
      live = false;
    };
  }, [version]);

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const start = await requestJson<{ token: string; options: PublicKeyCredentialCreationOptionsJSON }>(
        "/api/me/passkeys",
        { method: "POST", body: { action: "start" } },
      );
      const response = await startRegistration({ optionsJSON: start.options });
      await requestJson("/api/me/passkeys", {
        method: "POST",
        body: { action: "finish", token: start.token, response, name: name.trim() || "Passkey" },
      });
      setName("");
      onMessage("Passkey gespeichert");
      setVersion((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof WebAuthnError && cause.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
          ? "Auf diesem Gerät ist bereits ein Passkey für dich gespeichert."
          : cause instanceof Error && cause.name === "NotAllowedError"
            ? "Abgebrochen – es wurde kein Passkey gespeichert."
            : cause instanceof Error
              ? cause.message
              : "Der Passkey konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (passkey: PasskeySummary) => {
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/me/passkeys", { method: "DELETE", body: { passkeyId: passkey.id } });
      onMessage(`Passkey „${passkey.name}“ entfernt`);
      setVersion((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Passkey konnte nicht entfernt werden.");
    } finally {
      setBusy(false);
    }
  };

  if (!passkeys) return <p aria-live="polite">{error || "Wird geladen …"}</p>;
  return (
    <div className="settings-mfa">
      {passkeys.length > 0 && (
        <div className="settings-notification-list">
          {passkeys.map((passkey) => (
            <article key={passkey.id}>
              <span className="settings-notification-icon">
                <ModuleIcon name="quality" />
              </span>
              <span>
                <strong>{passkey.name}</strong>
                <small>
                  Gespeichert {formatDateTime(passkey.createdAt)}
                  {passkey.lastUsedAt ? ` · zuletzt verwendet ${formatDateTime(passkey.lastUsedAt)}` : ""}
                </small>
              </span>
              <button className="quiet-button" type="button" disabled={busy} onClick={() => void remove(passkey)}>
                Entfernen
              </button>
            </article>
          ))}
        </div>
      )}
      {supported ? (
        <>
          <label className="settings-mfa-code">
            <span>Name für dieses Gerät</span>
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="z. B. Diensthandy"
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="settings-action">
            <button className="primary-button" type="button" disabled={busy} onClick={() => void add()}>
              Passkey hinzufügen
            </button>
          </div>
        </>
      ) : (
        <p>Dieser Browser unterstützt keine Passkeys.</p>
      )}
    </div>
  );
}
