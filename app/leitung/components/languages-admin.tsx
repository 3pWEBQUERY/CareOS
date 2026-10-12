"use client";

import { useState, useSyncExternalStore } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import {
  EditorDialog,
  LoadError,
  formatDateTime,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { LANGUAGE_KEY, REVIEW_KEY, activeLanguage } from "@/app/components/translator";
import {
  LANGUAGES,
  type Language,
  type LanguageState,
  type TranslationEntry,
  type TranslationStatus,
} from "@/lib/i18n-shared";

type Payload = { languages: LanguageState[]; entries?: TranslationEntry[]; matching?: number; offset?: number };

const STATUS: Record<TranslationStatus, string> = { missing: "Fehlt", draft: "Entwurf", reviewed: "Geprüft" };
const FILTERS: Array<[TranslationStatus | "", string]> = [
  ["", "Alle"],
  ["missing", "Fehlt"],
  ["draft", "Entwurf"],
  ["reviewed", "Geprüft"],
];

// Leitung › Administration › Sprachen: Übersetzungen der Oberfläche prüfen, bearbeiten, von der KI entwerfen lassen
// und die Sprache für alle freigeben. Mitarbeitende sehen nur geprüfte Übersetzungen freigegebener Sprachen.
export default function LanguagesAdmin() {
  return (
    <ModulePageShell
      activeModule="admin"
      activeChild="Sprachen"
      pageClass="leadership-page leadership-users languages-admin-page"
    >
      {(showToast) => <LanguagesBody showToast={showToast} />}
    </ModulePageShell>
  );
}

function LanguagesBody({ showToast }: { showToast: ShowToast }) {
  const [locale, setLocale] = useState<Exclude<Language, "de">>("fr");
  const [filter, setFilter] = useState<TranslationStatus | "">("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<TranslationEntry | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const params = new URLSearchParams({ locale, offset: String(offset) });
  if (filter) params.set("filter", filter);
  if (query.trim()) params.set("q", query.trim());
  const data = useApiData<Payload>(`/api/admin/translations?${params}`);
  const languages = data.data?.languages ?? [];
  const current = languages.find((entry) => entry.locale === locale);
  const entries = data.data?.entries ?? [];
  const matching = data.data?.matching ?? 0;

  const post = async (body: Record<string, unknown>, message: (result: Record<string, number>) => string) => {
    setBusy(true);
    try {
      const result = await requestJson<Record<string, number>>("/api/admin/translations", { method: "POST", body });
      showToast(message(result));
      data.reload();
    } catch (cause) {
      showToast((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (reviewed: boolean) => {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/admin/translations", {
        method: "PUT",
        body: { locale, source: editing.source, target, reviewed },
      });
      setEditing(null);
      data.reload();
      showToast(reviewed ? "Übersetzung geprüft" : "Übersetzung gespeichert");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Zum Prüfen im Zusammenhang: die App in dieser Sprache mit Entwürfen anzeigen (nur Administration).
  const shownLanguage = useSyncExternalStore(
    () => () => undefined,
    activeLanguage,
    () => "de",
  );
  const previewing = shownLanguage === locale;
  const preview = () => {
    try {
      if (previewing) {
        localStorage.removeItem(LANGUAGE_KEY);
        localStorage.removeItem(REVIEW_KEY);
      } else {
        localStorage.setItem(LANGUAGE_KEY, locale);
        localStorage.setItem(REVIEW_KEY, "1");
      }
    } catch {
      showToast("Ohne Browserspeicher ist die Vorschau nicht möglich.");
      return;
    }
    window.location.reload();
  };

  return (
    <main className="workspace leadership-workspace leadership-users languages-admin">
      <header className="leadership-heading page-heading">
        <div className="heading-copy">
          <p className="eyebrow">Administration</p>
          <h1>Sprachen</h1>
          <p>
            Übersetzungen der Oberfläche prüfen und freigeben. Mitarbeitende sehen nur geprüfte Texte freigegebener
            Sprachen; Ungeprüftes erscheint auf Deutsch.
          </p>
        </div>
      </header>
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <section className="card admin-terminology-card" aria-labelledby="languages-title">
        <div className="card-header">
          <div>
            <p className="eyebrow">Sprachen</p>
            <h2 className="card-title" id="languages-title">
              Stand der Übersetzungen
            </h2>
            <p className="card-subtitle">{current ? `${current.total} Texte je Sprache` : "Wird geladen …"}</p>
          </div>
        </div>
        <div className="admin-retention-list">
          {languages.map((entry) => (
            <div className="admin-retention-row" key={entry.locale}>
              <span>
                <strong>
                  {LANGUAGES[entry.locale].label} <small>{entry.released ? "freigegeben" : "nicht freigegeben"}</small>
                </strong>
                <small>
                  {entry.reviewed} geprüft · {entry.drafts} Entwürfe · {entry.total - entry.reviewed - entry.drafts}{" "}
                  fehlen
                </small>
              </span>
              <div className="admin-webhook-actions">
                <button
                  className={entry.locale === locale ? "secondary-button" : "quiet-button"}
                  type="button"
                  aria-pressed={entry.locale === locale}
                  onClick={() => {
                    setLocale(entry.locale as Exclude<Language, "de">);
                    setOffset(0);
                  }}
                >
                  Prüfen
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void post({ action: "release", locale: entry.locale, released: !entry.released }, () =>
                      entry.released
                        ? `${LANGUAGES[entry.locale].label}: Freigabe zurückgezogen`
                        : `${LANGUAGES[entry.locale].label} freigegeben`,
                    )
                  }
                >
                  {entry.released ? "Freigabe zurückziehen" : "Freigeben"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card admin-terminology-card languages-entries" aria-labelledby="languages-entries-title">
        <div className="card-header">
          <div>
            <p className="eyebrow">{LANGUAGES[locale].label}</p>
            <h2 className="card-title" id="languages-entries-title">
              Texte prüfen
            </h2>
            <p className="card-subtitle">
              {matching} Texte{matching > 50 ? ` · ${offset + 1}–${Math.min(offset + 50, matching)}` : ""}
            </p>
          </div>
        </div>
        <div className="admin-branding-body">
          <div className="care-supply-filters" role="group" aria-label="Texte filtern">
            {FILTERS.map(([key, label]) => (
              <button
                type="button"
                key={label}
                className={filter === key ? "active" : ""}
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key);
                  setOffset(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="languages-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
            placeholder="Text suchen …"
            aria-label="Text suchen"
          />
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() =>
              void post(
                { action: "draft", locale },
                (result) => `${result.drafted} KI-Entwürfe erstellt, ${result.remaining} fehlen noch`,
              )
            }
          >
            {busy ? "Bitte warten …" : "KI-Entwürfe für fehlende Texte"}
          </button>
          <button
            className="quiet-button languages-slide-button"
            type="button"
            title="Angezeigte Entwürfe als geprüft markieren"
            disabled={busy || !entries.some((entry) => entry.status === "draft")}
            onClick={() =>
              void post(
                {
                  action: "review",
                  locale,
                  sources: entries.filter((entry) => entry.status === "draft").map((entry) => entry.source),
                },
                (result) => `${result.reviewed} Entwürfe als geprüft markiert`,
              )
            }
          >
            <SlideLabel text="Angezeigte Entwürfe als geprüft markieren" />
          </button>
          <button
            className="quiet-button languages-slide-button"
            type="button"
            title={previewing ? "Vorschau beenden" : "App in dieser Sprache ansehen (mit Entwürfen)"}
            onClick={preview}
          >
            <SlideLabel text={previewing ? "Vorschau beenden" : "App in dieser Sprache ansehen (mit Entwürfen)"} />
          </button>
        </div>
        <div className="admin-retention-list" translate="no">
          {entries.map((entry) => (
            <button
              type="button"
              key={entry.source}
              className="admin-retention-row portal-account-row languages-entry"
              onClick={() => {
                setEditing(entry);
                setTarget(entry.target || entry.source);
                setError("");
              }}
            >
              <span>
                <strong>
                  {entry.source} {entry.pattern && <small>Muster</small>}
                </strong>
                <small>{entry.target || "–"}</small>
              </span>
              <span
                className={`status-badge ${entry.status === "reviewed" ? "stable" : entry.status === "draft" ? "attention" : "info"}`}
              >
                {STATUS[entry.status]}
                {entry.origin === "ai" && entry.status === "draft" ? " (KI)" : ""}
              </span>
            </button>
          ))}
          {data.data && !entries.length && <p className="list-hint">Keine Texte für diese Auswahl.</p>}
        </div>
        {matching > 50 && (
          <div className="admin-branding-body">
            <button
              className="quiet-button"
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Zurück
            </button>
            <button
              className="quiet-button"
              type="button"
              disabled={offset + 50 >= matching}
              onClick={() => setOffset(offset + 50)}
            >
              Weiter
            </button>
          </div>
        )}
      </section>

      {editing && (
        <EditorDialog
          id="translation-editor"
          eyebrow={`Sprachen · ${LANGUAGES[locale].label}`}
          title="Übersetzung prüfen"
          description={
            editing.pattern
              ? "Muster: Platzhalter wie {0} stehen für wechselnde Inhalte und müssen erhalten bleiben."
              : "Ganzer Text, wie er in der Oberfläche erscheint."
          }
          onClose={() => setEditing(null)}
          onSubmit={() => save(true)}
          saving={busy}
          error={error}
          submitLabel="Speichern und als geprüft markieren"
          extraActions={
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void save(false)}>
              Als Entwurf speichern
            </button>
          }
        >
          <div className="area-editor-wide languages-source" translate="no">
            <span>Deutsch</span>
            <p>{editing.source}</p>
          </div>
          <label className="area-editor-wide" translate="no">
            <span>{LANGUAGES[locale].label}</span>
            <textarea rows={4} value={target} onChange={(event) => setTarget(event.target.value)} required />
          </label>
          {editing.updatedAt && (
            <p className="area-editor-wide list-hint">
              Zuletzt geändert {formatDateTime(editing.updatedAt)}
              {editing.updatedBy ? ` von ${editing.updatedBy}` : ""}
              {editing.origin === "ai" ? " · Entwurf der KI" : ""}
            </p>
          )}
        </EditorDialog>
      )}
    </main>
  );
}

// Kompakter Knopf: der Text gleitet beim Darüberfahren oder Fokussieren durch, bis das Ende sichtbar ist.
function SlideLabel({ text }: { text: string }) {
  return (
    <span className="languages-slide-track">
      <span className="languages-slide-text">{text}</span>
    </span>
  );
}
