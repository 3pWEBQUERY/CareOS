"use client";

import { useState, type FormEvent } from "react";
import type { AdminCareUnit, AdminQualification, ManagedRole, ManagedUser } from "@/lib/admin-users";
import { useWorkContext } from "@/app/components/care-context";
import { Data, EmployeeFields, Confirm, Overlay, QualificationFields, initials } from "./admin-user-parts";

export function EmployeeEditor({
  user,
  careUnits,
  roles,
  qualifications,
  mailEnabled,
  onClose,
  onUpdated,
}: {
  user: ManagedUser;
  careUnits: AdminCareUnit[];
  roles: ManagedRole[];
  qualifications: AdminQualification[];
  mailEnabled: boolean;
  onClose: () => void;
  onUpdated: (data: Data, message: string) => void;
}) {
  const self = useWorkContext()?.profile.userId === user.id;
  const [name, setName] = useState(user.displayName),
    [username, setUsername] = useState(user.username),
    [role, setRole] = useState(user.role),
    [job, setJob] = useState(user.jobTitle === "Noch nicht angegeben" ? "" : user.jobTitle),
    [phone, setPhone] = useState(user.phone),
    [email, setEmail] = useState(user.email),
    [unit, setUnit] = useState(user.primaryCareUnitId ?? ""),
    [held, setHeld] = useState<string[]>(user.qualificationIds),
    [mode, setMode] = useState<"edit" | "lock" | "delete" | "mfa">("edit"),
    [error, setError] = useState(""),
    [linkNotice, setLinkNotice] = useState(""),
    [saving, setSaving] = useState(false);
  // Link zum Setzen des Passworts an die gespeicherte E-Mail-Adresse senden (Einladung oder neues Passwort).
  async function sendLink() {
    setSaving(true);
    setLinkNotice("");
    try {
      const r = await fetch("/api/admin/users/password-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = (await r.json()) as { email?: string; error?: string };
      if (!r.ok) throw new Error(result.error);
      setLinkNotice(`Link an ${result.email} gesendet.`);
    } catch (e) {
      setLinkNotice(e instanceof Error && e.message ? e.message : "Der Link konnte nicht gesendet werden.");
    } finally {
      setSaving(false);
    }
  }
  // Alle Sitzungen der Person beenden (z. B. verlorenes Gerät); sie meldet sich danach überall neu an.
  async function endSessions() {
    setSaving(true);
    setLinkNotice("");
    try {
      const r = await fetch("/api/admin/users/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = (await r.json()) as { ended?: number; error?: string };
      if (!r.ok) throw new Error(result.error);
      setLinkNotice(
        result.ended
          ? `${result.ended} ${result.ended === 1 ? "Sitzung" : "Sitzungen"} beendet.`
          : "Es war keine Sitzung offen.",
      );
    } catch (e) {
      setLinkNotice(e instanceof Error && e.message ? e.message : "Die Sitzungen konnten nicht beendet werden.");
    } finally {
      setSaving(false);
    }
  }
  async function send(method: "PATCH" | "DELETE", body: object, success: string) {
    setSaving(true);
    try {
      const r = await fetch("/api/admin/users", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const next = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw new Error(next.error);
      onUpdated(next, success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Änderung nicht möglich");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Overlay title={`${user.displayName} verwalten`} onClose={onClose}>
      <div className="user-editor-body">
        <aside className="user-editor-summary">
          <span className="profile-large-avatar">{initials(user.displayName)}</span>
          <h3>{user.displayName}</h3>
          <p>@{user.username}</p>
          <div className="user-editor-actions">
            <button className={mode === "edit" ? "active" : ""} type="button" onClick={() => setMode("edit")}>
              Profil bearbeiten
            </button>
            <button
              className={mode === "lock" ? "active warning" : "warning"}
              type="button"
              onClick={() => setMode("lock")}
            >
              {user.active ? "Sperren & archivieren" : "Wiederherstellen"}
            </button>
            {user.mfa && (
              <button
                className={mode === "mfa" ? "active warning" : "warning"}
                type="button"
                onClick={() => setMode("mfa")}
              >
                Zwei-Faktor zurücksetzen
              </button>
            )}
            <button
              className={mode === "delete" ? "active danger" : "danger"}
              type="button"
              onClick={() => setMode("delete")}
            >
              Endgültig löschen
            </button>
            {mailEnabled && user.active && user.email && (
              <button type="button" disabled={saving} onClick={() => void sendLink()}>
                Link zum Passwort setzen senden
              </button>
            )}
            {!self && (
              <button type="button" disabled={saving} onClick={() => void endSessions()}>
                Alle Sitzungen beenden
              </button>
            )}
          </div>
          {linkNotice && (
            <p className="user-editor-link-notice" role="status">
              {linkNotice}
            </p>
          )}
        </aside>
        <section className="user-editor-content">
          {mode === "edit" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(
                  "PATCH",
                  {
                    userId: user.id,
                    displayName: name,
                    username,
                    role,
                    jobTitle: job,
                    phone,
                    email,
                    primaryCareUnitId: unit || null,
                    qualificationIds: held,
                  },
                  "Mitarbeiterprofil gespeichert",
                );
              }}
            >
              <EmployeeFields
                {...{
                  name,
                  setName,
                  username,
                  setUsername,
                  role,
                  setRole,
                  job,
                  setJob,
                  phone,
                  setPhone,
                  email,
                  setEmail,
                  unit,
                  setUnit,
                  roles,
                  careUnits,
                }}
              />
              <QualificationFields qualifications={qualifications} selected={held} onChange={setHeld} />
              {error && <p className="user-editor-error">{error}</p>}
              <footer className="user-editor-footer">
                <button className="primary-button" disabled={saving}>
                  Änderungen speichern
                </button>
              </footer>
            </form>
          ) : (
            <Confirm
              mode={mode}
              active={user.active}
              saving={saving}
              error={error}
              onBack={() => setMode("edit")}
              onConfirm={() =>
                void send(
                  mode === "delete" ? "DELETE" : "PATCH",
                  mode === "delete"
                    ? { userId: user.id }
                    : mode === "mfa"
                      ? { userId: user.id, action: "resetMfa" }
                      : { userId: user.id, action: user.active ? "lock" : "restore" },
                  mode === "mfa" ? "Zwei-Faktor-Anmeldung zurückgesetzt" : "Mitarbeiter aktualisiert",
                )
              }
            />
          )}
        </section>
      </div>
    </Overlay>
  );
}

export function EmployeeCreator({
  careUnits,
  roles,
  mailEnabled,
  onClose,
  onCreated,
}: {
  careUnits: AdminCareUnit[];
  roles: ManagedRole[];
  mailEnabled: boolean;
  onClose: () => void;
  onCreated: (data: Data, message: string) => void;
}) {
  const [name, setName] = useState(""),
    [username, setUsername] = useState(""),
    [role, setRole] = useState(roles.find((r) => r.key === "pflege")?.key ?? roles[0]?.key ?? ""),
    [job, setJob] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [invite, setInvite] = useState(true),
    [unit, setUnit] = useState(careUnits[0]?.id ?? ""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const inviting = mailEnabled && Boolean(email) && invite;
  // Öffnet sich der Dialog, bevor Rollen und Wohnbereiche geladen sind, gelten danach die Vorgaben.
  const chosenRole = role || roles.find((r) => r.key === "pflege")?.key || roles[0]?.key || "",
    chosenUnit = unit || careUnits[0]?.id || "";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: name,
          username,
          role: chosenRole,
          jobTitle: job,
          phone,
          email,
          primaryCareUnitId: chosenUnit || null,
          ...(inviting ? { invite: true } : { password }),
        }),
      });
      const next = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw new Error(next.error);
      onCreated(
        next,
        !inviting
          ? "Mitarbeiter erstellt"
          : next.inviteFailed
            ? "Mitarbeiter erstellt – die Einladung konnte nicht gesendet werden"
            : `Mitarbeiter erstellt, Einladung an ${email} gesendet`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mitarbeiter konnte nicht erstellt werden.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Overlay title="Mitarbeiter erstellen" onClose={onClose}>
      <div className="user-editor-body">
        <aside className="user-editor-summary">
          <span className="profile-large-avatar">{initials(name || "Neue Person")}</span>
          <h3>{name || "Mitarbeiter:in"}</h3>
          <p>Neues Zugangsprofil</p>
        </aside>
        <section className="user-editor-content">
          <form onSubmit={submit}>
            <EmployeeFields
              {...{
                name,
                setName,
                username,
                setUsername,
                role: chosenRole,
                setRole,
                job,
                setJob,
                phone,
                setPhone,
                email,
                setEmail,
                unit: chosenUnit,
                setUnit,
                roles,
                careUnits,
              }}
            />
            {mailEnabled && email && (
              <div className="user-editor-fields">
                <label className="user-editor-invite">
                  <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
                  <span>
                    Per E-Mail einladen
                    <small>Die Person setzt ihr Passwort selbst über einen Link (7 Tage gültig).</small>
                  </span>
                </label>
              </div>
            )}
            {!inviting && (
              <div className="user-editor-fields">
                <label className="user-editor-password-field">
                  Startpasswort
                  <input
                    required
                    type="password"
                    minLength={10}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <small>Wird sicher als Hash gespeichert.</small>
                </label>
              </div>
            )}
            {error && <p className="user-editor-error">{error}</p>}
            <footer className="user-editor-footer">
              <button className="primary-button" disabled={saving}>
                Mitarbeiter erstellen
              </button>
            </footer>
          </form>
        </section>
      </div>
    </Overlay>
  );
}
