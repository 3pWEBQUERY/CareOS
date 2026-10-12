"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { Eye, EyeSlash, LockKey, Pulse, ShieldCheck, User } from "@phosphor-icons/react";
import { clearOfflineData, rememberOfflineUnlock } from "./components/offline-queue";
import { LoginBrandPanel } from "./components/login-brand-panel";
import { ForgotPasswordForm } from "./components/forgot-password-form";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Zwei-Faktor-Anmeldung: nach richtigem Passwort folgt der Code aus der Authenticator-App.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // Nach der automatischen Abmeldung (Einstellungen › Sicherheit) den Grund nennen.
  const idleSignOut = useSyncExternalStore(
    () => () => undefined,
    () => new URLSearchParams(window.location.search).get("abgemeldet") === "inaktiv",
    () => false,
  );
  // Rückmeldung einer abgebrochenen oder abgelehnten SSO-Anmeldung.
  const ssoError = useSyncExternalStore(
    () => () => undefined,
    () => new URLSearchParams(window.location.search).get("sso") ?? "",
    () => "",
  );
  const message =
    error ||
    ssoError ||
    (idleSignOut ? "Du wurdest nach längerer Inaktivität automatisch abgemeldet. Bitte melde dich erneut an." : "");
  // Eingeschaltete SSO-Anbieter (OpenID Connect); ohne Anbieter bleibt die Seite unverändert.
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  // „Passwort vergessen?“ nur mit eingerichtetem E-Mail-Versand.
  const [resetEnabled, setResetEnabled] = useState(false);
  const [forgot, setForgot] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/auth/password", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((data: { enabled?: boolean }) => live && setResetEnabled(Boolean(data.enabled)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    fetch("/api/auth/sso/providers", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { providers: [] }))
      .then((data: { providers?: Array<{ id: string; label: string }> }) => live && setProviders(data.providers ?? []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const ssoHref = (id: string) => {
    const next = new URLSearchParams(window.location.search).get("next");
    const params = new URLSearchParams({ provider: id });
    if (next?.startsWith("/c")) params.set("next", next);
    return `/api/auth/sso/start?${params}`;
  };
  const passkeys = useSyncExternalStore(
    () => () => undefined,
    () => browserSupportsWebAuthn(),
    () => false,
  );

  // Nach erfolgreicher Anmeldung: Seiten und Daten einer früheren Anmeldung auf diesem Gerät verwerfen, dann weiter.
  const enter = useCallback(
    (startPathInput: string | undefined) => {
      clearOfflineData();
      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const startPath = startPathInput?.startsWith("/c") ? startPathInput : "/c";
      router.replace(requestedPath?.startsWith("/c") ? requestedPath : startPath);
      router.refresh();
    },
    [router],
  );

  // Passkey: im Feld „Benutzername“ vorgeschlagen (autofill) oder über den Knopf. Ersetzt Passwort und Code.
  const passkeyLogin = useCallback(
    async (autofill: boolean) => {
      const start = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (!start.ok) throw new Error("Die Anmeldung mit Passkey ist derzeit nicht möglich.");
      const { token, options } = (await start.json()) as {
        token: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      };
      const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
      setPending(true);
      setError("");
      try {
        const finish = await fetch("/api/auth/passkey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "finish", token, response }),
        });
        const result = (await finish.json()) as { error?: string; startPath?: string };
        if (!finish.ok) {
          setError(result.error ?? "Anmeldung fehlgeschlagen.");
          return;
        }
        enter(result.startPath);
      } finally {
        setPending(false);
      }
    },
    [enter],
  );

  useEffect(() => {
    if (challenge) return;
    let live = true;
    void browserSupportsWebAuthnAutofill().then((available) => {
      // Abgebrochene Vorschläge (z. B. durch den Knopf oder das Passwort-Formular) sind kein Fehler.
      if (available && live) passkeyLogin(true).catch(() => undefined);
    });
    return () => {
      live = false;
    };
  }, [challenge, passkeyLogin]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(challenge ? "/api/auth/mfa" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(challenge ? { challenge, code } : { username, password }),
      });
      const result = (await response.json()) as {
        error?: string;
        startPath?: string;
        mfaRequired?: boolean;
        challenge?: string;
        restart?: boolean;
      };
      if (!response.ok) {
        setError(result.error ?? "Anmeldung fehlgeschlagen.");
        if (result.restart) {
          setChallenge(null);
          setCode("");
        }
        return;
      }
      if (result.mfaRequired && result.challenge) {
        setChallenge(result.challenge);
        setCode("");
        return;
      }
      enter(result.startPath);
      // Für das Entsperren ohne Verbindung (Schlüssel mit dem Passwort verschlüsselt auf dem Gerät).
      void rememberOfflineUnlock(password).catch(() => undefined);
    } catch {
      setError("Die Verbindung zum CareOS-Arbeitsplatz konnte nicht hergestellt werden.");
    } finally {
      setPending(false);
    }
  }

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
          {forgot ? (
            <ForgotPasswordForm initial={username} onBack={() => setForgot(false)} />
          ) : (
            <>
              <div className="login-heading">
                <p className="eyebrow">Willkommen zurück</p>
                <h2>Bei CareOS anmelden</h2>
                <p>Melde dich mit deinem persönlichen Benutzerkonto an.</p>
              </div>
              <form className="login-form" method="post" onSubmit={submit}>
                {challenge ? (
                  <>
                    <label htmlFor="mfa-code">Bestätigungscode</label>
                    <div className="login-input">
                      <ShieldCheck />
                      <input
                        id="mfa-code"
                        name="code"
                        inputMode="text"
                        autoComplete="one-time-code"
                        autoFocus
                        maxLength={12}
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        placeholder="6-stelliger Code"
                        required
                      />
                    </div>
                    <p className="login-mfa-hint">
                      Code aus deiner Authenticator-App eingeben – oder einen Wiederherstellungscode.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setChallenge(null);
                          setCode("");
                          setError("");
                        }}
                      >
                        Zurück
                      </button>
                    </p>
                  </>
                ) : (
                  <>
                    <label htmlFor="username">Benutzername</label>
                    <div className="login-input">
                      <User />
                      <input
                        id="username"
                        name="username"
                        autoComplete="username webauthn"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="Benutzername eingeben"
                        required
                      />
                    </div>
                    <div className="login-password-label">
                      <label htmlFor="password">Passwort</label>
                      {resetEnabled ? (
                        <button className="login-forgot-link" type="button" onClick={() => setForgot(true)}>
                          Passwort vergessen?
                        </button>
                      ) : (
                        <span>Geschützter Zugang</span>
                      )}
                    </div>
                    <div className="login-input">
                      <LockKey />
                      <input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Passwort eingeben"
                        required
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Passwort ausblenden" : "Passwort anzeigen"}
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword((value) => !value)}
                      >
                        {showPassword ? <EyeSlash /> : <Eye />}
                      </button>
                    </div>
                  </>
                )}
                {message && (
                  <div className="login-error" role="alert">
                    {message}
                  </div>
                )}
                <button className="login-submit" type="submit" disabled={pending}>
                  {pending ? (
                    <>
                      <span className="login-spinner" />
                      Anmeldung wird geprüft …
                    </>
                  ) : (
                    <>
                      Sicher anmelden <span aria-hidden="true">→</span>
                    </>
                  )}
                </button>
              </form>
              {providers.length > 0 && !challenge && (
                <p className="login-mfa-hint">
                  {providers.map((provider, index) => (
                    <span key={provider.id}>
                      {index > 0 && " · "}
                      <a href={ssoHref(provider.id)}>Mit {provider.label} anmelden</a>
                    </span>
                  ))}
                </p>
              )}
              {passkeys && !challenge && (
                <p className="login-mfa-hint">
                  Passkey auf diesem Gerät?{" "}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      void passkeyLogin(false).catch((cause: Error) =>
                        setError(
                          cause.name === "NotAllowedError"
                            ? "Anmeldung mit Passkey abgebrochen."
                            : cause.message || "Anmeldung mit Passkey fehlgeschlagen.",
                        ),
                      )
                    }
                  >
                    Mit Passkey anmelden
                  </button>
                </p>
              )}
            </>
          )}
          <div className="login-support">
            <ShieldCheck />
            <span>
              <strong>Probleme bei der Anmeldung?</strong>
              <small>Wende dich an deine CareOS-Administration.</small>
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
