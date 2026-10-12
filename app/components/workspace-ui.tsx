"use client";

// Building blocks shared by the database-backed module workspaces (data loading,
// formatting, headings, tiles, empty/error states and editor dialogs).

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, X } from "@phosphor-icons/react";
import { type ModuleIconName } from "@/app/components/module-icon";
import { ModuleIcon } from "@/app/components/module-icon";
import { useEscapeClose } from "./use-escape-close";
import { LOCKED_EVENT, UNLOCK_EVENT } from "./offline-queue";
import "./workspace-ui.css";

export type ShowToast = (message: string) => void;

// Zuletzt geladene Daten je Adresse, nur im Arbeitsspeicher dieses Tabs: Beim erneuten Öffnen einer Seite sind sie
// sofort sichtbar und werden im Hintergrund neu geladen. Jede Änderung an Daten (POST, PATCH, DELETE …) verwirft alles,
// damit nach dem Speichern nie ein alter Stand erscheint.
const apiCache = new Map<string, { data: unknown; at: number }>();
const CACHE_MS = 5 * 60_000;
const CACHE_ENTRIES = 80;

function cachedData<T>(url: string): T | undefined {
  const entry = apiCache.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_MS) {
    apiCache.delete(url);
    return undefined;
  }
  return entry.data as T;
}

function remember(url: string, data: unknown) {
  apiCache.delete(url);
  apiCache.set(url, { data, at: Date.now() });
  while (apiCache.size > CACHE_ENTRIES) apiCache.delete(apiCache.keys().next().value!);
}

export const clearApiCache = () => apiCache.clear();

// Auch Änderungen, die nicht über requestJson laufen (Dienstplan, Warteschlange ohne Verbindung …), leeren den Speicher.
if (typeof window !== "undefined" && !(window.fetch as { carecoreWatched?: boolean }).carecoreWatched) {
  const original = window.fetch.bind(window);
  const watched = ((input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") apiCache.clear();
    return original(input, init);
  }) as typeof window.fetch & { carecoreWatched?: boolean };
  watched.carecoreWatched = true;
  window.fetch = watched;
}

export async function requestJson<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    cache: "no-store",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload = await response.json().catch(() => null);
  if (payload?.locked === true) window.dispatchEvent(new Event(LOCKED_EVENT));
  if (!response.ok) throw new Error(payload?.error || "Die Anfrage ist fehlgeschlagen.");
  return payload as T;
}

// Loads JSON for `url`; `reload()` refetches while keeping the previous data visible.
export function useApiData<T>(url: string | null) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ key: string; url: string; data?: T; error?: string } | null>(null);
  const key = url ? `${url}#${version}` : null;
  useEffect(() => {
    if (!url || !key) return;
    let cancelled = false;
    requestJson<T>(url).then(
      (data) => {
        remember(url, data);
        if (!cancelled) setState({ key, url, data });
      },
      (error: Error) => !cancelled && setState({ key, url, error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [url, key]);
  const reload = useCallback(() => setVersion((current) => current + 1), []);
  // Ohne Verbindung mit dem Passwort entsperrt: gesperrte Daten neu laden.
  useEffect(() => {
    window.addEventListener(UNLOCK_EVENT, reload);
    return () => window.removeEventListener(UNLOCK_EVENT, reload);
  }, [reload]);
  const sameUrl = state && state.url === url ? state : null;
  // Noch nichts geladen: der letzte Stand dieser Adresse, bis die frischen Daten da sind.
  const data = sameUrl ? sameUrl.data : url ? cachedData<T>(url) : undefined;
  return { data, error: sameUrl?.error, loading: !state || state.key !== key, reload };
}

const zurich = "Europe/Zurich";

export function todayInZurich() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zurich }).format(new Date());
}

export function timeInZurich(date = new Date()) {
  return date.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: zurich });
}

export function formatDate(value: string | null) {
  if (!value) return "–";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null) {
  if (!value) return "–";
  const date = new Date(value);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zurich }).format(date);
  const today = todayInZurich();
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: zurich }).format(new Date(Date.now() - 86_400_000));
  const prefix = day === today ? "Heute" : day === yesterday ? "Gestern" : formatDate(day);
  return `${prefix}, ${timeInZurich(date)}`;
}

export function formatNumber(value: number) {
  return value.toLocaleString("de-CH", { maximumFractionDigits: 2 });
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <section className="page-heading care-page-heading" aria-labelledby="page-title">
      <div className="heading-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="page-title">{title}</h1>
        <p>{description}</p>
      </div>
      {action && (
        <button className="primary-button" type="button" onClick={action.onClick} disabled={action.disabled}>
          <ModuleIcon name="plus" className="button-icon" />
          {action.label}
        </button>
      )}
    </section>
  );
}

export function SummaryTiles({
  label,
  tiles,
  className,
}: {
  label: string;
  tiles: Array<{ icon: ModuleIconName; value: ReactNode; caption: string; tone?: "attention" | "info" | "critical" }>;
  className?: string;
}) {
  return (
    <section className={className ? `wound-summary ${className}` : "wound-summary"} aria-label={label}>
      {tiles.map((tile) => (
        <div key={tile.caption}>
          <span className={`summary-icon ${tile.tone ?? ""}`}>
            <ModuleIcon name={tile.icon} />
          </span>
          <span>
            <strong>{tile.value}</strong>
            <small>{tile.caption}</small>
          </span>
        </div>
      ))}
    </section>
  );
}

export function EmptyState({ icon = "med", title, text }: { icon?: ModuleIconName; title: string; text: string }) {
  return (
    <div className="resident-empty">
      <ModuleIcon name={icon} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="critical-alert" role="alert">
      <span className="critical-symbol">
        <ModuleIcon name="alert" />
      </span>
      <div>
        <strong>Daten konnten nicht geladen werden</strong>
        <p>{message}</p>
      </div>
      <button className="secondary-button" type="button" onClick={onRetry}>
        Erneut laden
      </button>
    </section>
  );
}

// Side panel dialog used for all editor forms.
export function EditorDialog({
  id,
  eyebrow,
  title,
  description,
  onClose,
  onSubmit,
  saving,
  error,
  submitLabel,
  danger,
  children,
  extraActions,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  saving: boolean;
  error: string;
  submitLabel: string;
  danger?: boolean;
  children: ReactNode;
  extraActions?: ReactNode;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit();
  };
  useEscapeClose(() => !saving && onClose());
  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !saving) onClose();
      }}
    >
      <section
        className="area-editor-panel editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={`${id}-title`}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="area-editor-close" type="button" aria-label="Fenster schliessen" onClick={onClose}>
            <X />
          </button>
        </header>
        <form className="area-editor-form" onSubmit={submit}>
          <div className="area-editor-grid">{children}</div>
          {error && (
            <p className="appointment-editor-error" role="alert">
              {error}
            </p>
          )}
          <footer className="area-editor-actions appointment-editor-actions">
            {extraActions}
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
              Abbrechen
            </button>
            <button className={danger ? "appointment-danger-button" : "primary-button"} type="submit" disabled={saving}>
              <Check /> {saving ? "Speichern…" : submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

// Asks for a mandatory reason, e.g. for declined doses or stopped orders.
export function ReasonDialog({
  eyebrow = "CareOS · Dokumentation",
  title,
  description,
  label,
  placeholder,
  submitLabel,
  danger,
  onClose,
  onConfirm,
  children,
}: {
  children?: ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!reason.trim()) {
      setError("Bitte eine Begründung angeben.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onConfirm(reason.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };
  return (
    <EditorDialog
      id="med-reason"
      eyebrow={eyebrow}
      title={title}
      description={description}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={submitLabel}
      danger={danger}
    >
      {children}
      <label className="area-editor-wide">
        <span>{label}</span>
        <textarea
          autoFocus
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={placeholder}
        />
      </label>
    </EditorDialog>
  );
}
