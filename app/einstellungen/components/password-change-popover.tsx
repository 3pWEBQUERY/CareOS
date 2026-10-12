"use client";

import { requestJson } from "@/app/components/workspace-ui";
import { useEffect, useState, type FormEvent } from "react";
import { ModuleIcon } from "@/app/components/module-icon";

type PasswordChangePopoverProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function PasswordChangePopover({ open, onClose, onSuccess }: PasswordChangePopoverProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentPassword || !newPassword || !confirmation) {
      setError("Bitte fülle alle Felder aus.");
      return;
    }
    if (newPassword.length < 10) {
      setError("Das neue Passwort muss mindestens 10 Zeichen lang sein.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("Die neuen Passwörter stimmen nicht überein.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/me/password", { method: "POST", body: { currentPassword, newPassword } });
      onSuccess();
      onClose();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="settings-password-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className="settings-password-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-dialog-title"
      >
        <header className="settings-password-header">
          <div className="settings-password-heading">
            <span className="settings-password-icon">
              <ModuleIcon name="quality" />
            </span>
            <div>
              <p className="eyebrow">Sicherheit &amp; Zugriff</p>
              <h2 id="password-dialog-title">Passwort ändern</h2>
              <p>Schütze deinen Zugang mit einem neuen, sicheren Passwort.</p>
            </div>
          </div>
          <button
            className="settings-password-close"
            type="button"
            onClick={onClose}
            aria-label="Passwortdialog schliessen"
          >
            ×
          </button>
        </header>
        <form className="settings-password-form" onSubmit={(event) => void submit(event)}>
          <p className="settings-password-note">
            <ModuleIcon name="alert" /> Verwende ein Passwort, das du nur für CareOS nutzt.
          </p>
          <PasswordField
            id="current-password"
            label="Aktuelles Passwort"
            value={currentPassword}
            onChange={setCurrentPassword}
            visible={showCurrent}
            onToggle={() => setShowCurrent((value) => !value)}
          />
          <div className="settings-password-divider" aria-hidden="true" />
          <PasswordField
            id="new-password"
            label="Neues Passwort"
            value={newPassword}
            onChange={setNewPassword}
            visible={showNew}
            onToggle={() => setShowNew((value) => !value)}
            hint="Mindestens 8 Zeichen"
          />
          <PasswordField
            id="confirm-password"
            label="Neues Passwort bestätigen"
            value={confirmation}
            onChange={setConfirmation}
            visible={showConfirmation}
            onToggle={() => setShowConfirmation((value) => !value)}
          />
          {error && (
            <p className="settings-password-error" role="alert">
              <ModuleIcon name="alert" />
              {error}
            </p>
          )}
          <footer className="settings-password-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              <ModuleIcon name="check" />
              {saving ? "Wird gespeichert …" : "Passwort speichern"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  visible,
  onToggle,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  hint?: string;
}) {
  return (
    <label className="settings-password-field" htmlFor={id}>
      <span>{label}</span>
      <div>
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={id === "current-password" ? "current-password" : "new-password"}
        />
        <button type="button" onClick={onToggle} aria-label={visible ? `${label} ausblenden` : `${label} anzeigen`}>
          {visible ? "Ausblenden" : "Anzeigen"}
        </button>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}
