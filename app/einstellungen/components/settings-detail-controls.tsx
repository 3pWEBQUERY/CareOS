"use client";

import { useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import { formatDateTime } from "@/app/components/workspace-ui";
import { SETTING_DEFINITIONS } from "@/lib/settings-shared";
import { type NotifyCategory, type QuietHours, type UserSettings } from "@/lib/user-settings-shared";
import SettingsSelect from "./settings-select";
import PushControl from "./push-control";
import MfaControl from "./mfa-control";
import PasskeyControl from "./passkey-control";
import { SettingsView, Item } from "./settings-detail-items";

export function DetailControl({
  item,
  data,
  onOpenView,
  onProfile,
  onPassword,
  onToggle,
  onEndSessions,
  onMessage,
  onChanged,
}: {
  item: Item;
  data: UserSettings;
  onOpenView: (view: SettingsView) => void;
  onProfile: () => void;
  onPassword: () => void;
  onMessage: (message: string) => void;
  onChanged: () => void;
  onToggle: (category: NotifyCategory, value: boolean) => void;
  onEndSessions: (id: string | null) => void;
}) {
  const detail = item.detail;
  if (detail.kind === "open")
    return (
      <div className="settings-action">
        <span>{item.title}</span>
        <button className="secondary-button" type="button" onClick={() => onOpenView(detail.view)}>
          Öffnen
        </button>
      </div>
    );
  if (detail.kind === "profile")
    return (
      <div className="settings-action">
        <span>Funktion, Telefon, fester Wohnbereich</span>
        <button className="secondary-button" type="button" onClick={onProfile}>
          Profil bearbeiten
        </button>
      </div>
    );
  if (detail.kind === "password")
    return (
      <div className="settings-action">
        <span>Mindestens 10 Zeichen</span>
        <button className="secondary-button" type="button" onClick={onPassword}>
          Passwort ändern
        </button>
      </div>
    );
  if (detail.kind === "notify")
    return (
      <label className="settings-toggle">
        <span>Benachrichtigungen erhalten</span>
        <input
          type="checkbox"
          checked={data.preferences.notify[detail.category]}
          onChange={(event) => onToggle(detail.category, event.target.checked)}
        />
        <i />
      </label>
    );
  if (detail.kind === "push") return <PushControl onMessage={onMessage} />;
  if (detail.kind === "mfa") return <MfaControl onMessage={onMessage} onChanged={onChanged} />;
  if (detail.kind === "passkeys") return <PasskeyControl onMessage={onMessage} onChanged={onChanged} />;
  if (detail.kind === "toggle")
    return (
      <>
        <label className="settings-toggle">
          <span>{detail.label}</span>
          <input type="checkbox" checked={detail.checked} onChange={(event) => detail.save(event.target.checked)} />
          <i />
        </label>
        {detail.note && <p className="settings-note">{detail.note}</p>}
      </>
    );
  if (detail.kind === "quiet") return <QuietHoursControl key={JSON.stringify(detail.value)} detail={detail} />;
  if (detail.kind === "action")
    return (
      <div className="settings-action">
        <span>{item.title}</span>
        <button
          className={detail.danger ? "appointment-danger-button" : "secondary-button"}
          type="button"
          onClick={detail.run}
        >
          {detail.label}
        </button>
      </div>
    );
  if (detail.kind === "link")
    return (
      <div className="settings-action">
        <span>{item.title}</span>
        <a className="secondary-button settings-link-button" href={detail.href}>
          {detail.label}
        </a>
      </div>
    );
  if (detail.kind === "organization")
    return <OrganizationSettingControl key={JSON.stringify(detail.value)} detail={detail} />;
  if (detail.kind === "select")
    return (
      <label className="settings-select">
        <span>{detail.label}</span>
        <SettingsSelect label={detail.label} value={detail.value} options={detail.options} onChange={detail.save} />
      </label>
    );
  if (detail.kind === "sessions")
    return (
      <div className="settings-notification-summary">
        <div className="settings-notification-list">
          {data.security.sessions.map((session) => (
            <article key={session.id}>
              <span className="settings-notification-icon">
                <ModuleIcon name={session.current ? "check" : "pulse"} />
              </span>
              <span>
                <strong>{session.device}</strong>
                <small>Angemeldet {formatDateTime(session.createdAt)}</small>
              </span>
              {session.current ? (
                <span className="settings-notification-value">Dieses Gerät</span>
              ) : (
                <button className="quiet-button" type="button" onClick={() => onEndSessions(session.id)}>
                  Abmelden
                </button>
              )}
            </article>
          ))}
        </div>
        <button
          className="secondary-button settings-notification-link"
          type="button"
          disabled={data.security.sessions.length < 2}
          onClick={() => onEndSessions(null)}
        >
          Alle anderen Geräte abmelden
        </button>
      </div>
    );
  return detail.lines?.length ? (
    <ul className="settings-permission-list">
      {detail.lines.map((line) => (
        <li key={line}>
          <ModuleIcon name="check" /> {line}
        </li>
      ))}
    </ul>
  ) : null;
}

type QuietDetail = Extract<Item["detail"], { kind: "quiet" }>;
type OrganizationDetail = Extract<Item["detail"], { kind: "organization" }>;

// Ruhezeit für Push-Nachrichten: ein/aus und Beginn/Ende (Ortszeit der Einrichtung).
function QuietHoursControl({ detail }: { detail: QuietDetail }) {
  const [draft, setDraft] = useState(detail.value);
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(detail.value);
  const save = async (next: QuietHours) => {
    setSaving(true);
    await detail.save(next);
    setSaving(false);
  };
  return (
    <div className="settings-quiet">
      <label className="settings-toggle">
        <span>Ruhezeit einhalten</span>
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={saving}
          onChange={(event) => {
            const next = { ...draft, enabled: event.target.checked };
            setDraft(next);
            void save(next);
          }}
        />
        <i />
      </label>
      <label className="settings-toggle">
        <span>Kritische Hinweise auch in der Ruhezeit</span>
        <input
          type="checkbox"
          checked={draft.critical}
          disabled={saving}
          onChange={(event) => {
            const next = { ...draft, critical: event.target.checked };
            setDraft(next);
            void save(next);
          }}
        />
        <i />
      </label>
      <div className="settings-quiet-times">
        <label>
          <span>Von</span>
          <input
            type="time"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label>
          <span>Bis</span>
          <input type="time" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
        </label>
        <button
          className="secondary-button"
          type="button"
          disabled={!changed || saving}
          onClick={() => void save(draft)}
        >
          Zeiten speichern
        </button>
      </div>
    </div>
  );
}

// Einstellung der Einrichtung (Leitung › Konfiguration): ein/aus und, wo vorgesehen, ein Wert.
function OrganizationSettingControl({ detail }: { detail: OrganizationDetail }) {
  const definition = SETTING_DEFINITIONS[detail.setting];
  const [value, setValue] = useState(detail.value.value === null ? "" : String(detail.value.value));
  const [saving, setSaving] = useState(false);
  const number = Number(value);
  const valid =
    value.trim() !== "" &&
    Number.isInteger(number) &&
    number >= (definition.min ?? 0) &&
    number <= (definition.max ?? Infinity);
  const save = async (change: { enabled?: boolean; value?: number }) => {
    setSaving(true);
    await detail.save(change);
    setSaving(false);
  };
  return (
    <div className="settings-quiet">
      <label className="settings-toggle">
        <span>Eingeschaltet</span>
        <input
          type="checkbox"
          checked={detail.value.enabled}
          disabled={saving}
          onChange={(event) => void save({ enabled: event.target.checked })}
        />
        <i />
      </label>
      {definition.unit && (
        <div className="settings-quiet-times">
          <label>
            <span>
              Wert ({definition.unit}, {definition.min}–{definition.max})
            </span>
            <input inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={saving || !valid || number === detail.value.value}
            onClick={() => void save({ value: number })}
          >
            Wert speichern
          </button>
        </div>
      )}
    </div>
  );
}
