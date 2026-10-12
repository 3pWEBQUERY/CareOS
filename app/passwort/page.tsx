"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { CheckCircle, LockKey, Pulse } from "@phosphor-icons/react";
import Link from "next/link";
import { LoginBrandPanel } from "../components/login-brand-panel";

type LinkState =
  { status: "checking" } | { status: "invalid" } | { status: "valid"; username: string; purpose: string };

// Passwort mit dem Link aus der E-Mail setzen („Passwort vergessen“ oder Einladung der Administration).
export default function SetPasswordPage() {
  const token = useSyncExternalStore(
    () => () => undefined,
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    () => "",
  );
  const [link, setLink] = useState<LinkState>({ status: "checking" });
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    fetch(`/api/auth/password/set?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { valid: false }))
      .then((data: { valid?: boolean; username?: string; purpose?: string }) => {
        if (!live) return;
        setLink(
          data.valid
            ? { status: "valid", username: data.username ?? "", purpose: data.purpose ?? "" }
            : { status: "invalid" },
        );
      })
      .catch(() => live && setLink({ status: "invalid" }));
    return () => {
      live = false;
    };
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== repeat) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password/set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Das Passwort konnte nicht gesetzt werden.");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Das Passwort konnte nicht gesetzt werden.");
    } finally {
      setPending(false);
    }
  }

  const state: LinkState = token ? link : { status: "invalid" };
  const invite = state.status === "valid" && state.purpose === "invite";
  return (
    <main className="login-page">
      <LoginBrandPanel />
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="login-mobile-brand">
            <span>
              <Pulse />
            </span>
            <strong>CareOS</strong>
          </div>
          <div className="login-heading">
            <p className="eyebrow">{invite ? "Zugang einrichten" : "Passwort neu setzen"}</p>
            <h2>
              {done
                ? "Passwort gespeichert"
                : state.status === "invalid"
                  ? "Link nicht mehr gültig"
                  : invite
                    ? "Willkommen bei CareOS"
                    : "Neues Passwort festlegen"}
            </h2>
            <p>
              {done
                ? "Du kannst dich jetzt mit dem neuen Passwort anmelden."
                : state.status === "valid"
                  ? `Für das Konto „${state.username}“. Mindestens 10 Zeichen.`
                  : state.status === "checking"
                    ? "Der Link wird geprüft …"
                    : "Der Link ist abgelaufen oder wurde bereits verwendet."}
            </p>
          </div>
          {done ? (
            <div className="login-form">
              <div className="login-notice" role="status">
                <CheckCircle />
                <span>Alle bisherigen Sitzungen wurden aus Sicherheitsgründen beendet.</span>
              </div>
              <Link className="login-submit" href="/">
                Zur Anmeldung <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : state.status === "invalid" ? (
            <div className="login-form">
              <Link className="login-submit" href="/">
                Zur Anmeldung <span aria-hidden="true">→</span>
              </Link>
              <p className="login-mfa-hint">
                Auf der Anmeldeseite lässt sich über „Passwort vergessen?“ ein neuer Link anfordern.
              </p>
            </div>
          ) : state.status === "valid" ? (
            <form className="login-form" onSubmit={(event) => void submit(event)}>
              <input type="text" name="username" autoComplete="username" value={state.username} readOnly hidden />
              <label htmlFor="new-password">Neues Passwort</label>
              <div className="login-input">
                <LockKey />
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  minLength={10}
                  maxLength={200}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <label htmlFor="repeat-password">Passwort wiederholen</label>
              <div className="login-input">
                <LockKey />
                <input
                  id="repeat-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={200}
                  value={repeat}
                  onChange={(event) => setRepeat(event.target.value)}
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
                    Wird gespeichert …
                  </>
                ) : (
                  <>
                    Passwort speichern <span aria-hidden="true">→</span>
                  </>
                )}
              </button>
            </form>
          ) : null}
        </div>
      </section>
    </main>
  );
}
