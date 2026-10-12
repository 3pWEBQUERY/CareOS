"use client";

import { useState, type FormEvent } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDate,
  formatDateTime,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { DOC_CATEGORIES, IMPORTANCE, type DocEntry, type DocStats, type Importance } from "@/lib/documentation-shared";
import {
  AmendDialog,
  EntryDialog,
  EntryFields,
  EntryItem,
  newDraft,
  saveDraft,
  type EntryDraft,
  type ResidentOption,
} from "./entry-parts";
import { useCareResident, useResidentNavigation, useTerms } from "@/app/components/care-context";
import { ResuscitationBadge } from "@/app/components/resuscitation-badge";

export type DocumentationView = "quick" | "history";
type EntriesPayload = { entries: DocEntry[]; canWrite: boolean };

function useResidents() {
  const data = useApiData<{ residents: Array<{ id: string; first_name: string; last_name: string; room: string }> }>(
    "/api/residents",
  );
  return (data.data?.residents ?? []).map((r): ResidentOption => ({
    id: r.id,
    name: `${r.first_name} ${r.last_name}`,
    room: r.room,
  }));
}

function QuickView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const residents = useResidents();
  const today = useApiData<EntriesPayload>("/api/documentation?days=1");
  const stats = useApiData<DocStats>("/api/documentation/stats");
  const [draft, setDraft] = useState<EntryDraft>(() => newDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [amending, setAmending] = useState<DocEntry | null>(null);
  const canWrite = today.data?.canWrite ?? false;
  const [contextId, setContextId] = useCareResident();
  const navigation = useResidentNavigation();
  const contextResident = residents.find((r) => r.id === contextId)?.id;
  const effective = { ...draft, residentId: contextResident ?? "" };
  // Choosing a resident for the entry also makes it the working context of the other modules.
  const changeDraft = (next: EntryDraft) => {
    if (next.residentId && next.residentId !== effective.residentId) setContextId(next.residentId);
    setDraft(next);
  };
  const reload = () => {
    today.reload();
    stats.reload();
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const andNext = (event.nativeEvent as SubmitEvent).submitter?.dataset.next === "true";
    setSaving(true);
    setError("");
    try {
      const saved = await saveDraft(effective, residents.find((r) => r.id === effective.residentId)?.name ?? t.one);
      const next = andNext ? navigation.next() : null;
      showToast(next ? `${saved} · weiter mit ${next.name}` : saved);
      setDraft(newDraft(next?.id ?? effective.residentId));
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Dokumentation"
        title="Schnelldokumentation"
        description="Beobachtungen und Massnahmen direkt im Arbeitsfluss festhalten – mit Uhrzeit, Einordnung und Textbausteinen."
      />
      <SummaryTiles
        label="Dokumentation heute"
        tiles={[
          { icon: "note", value: stats.data?.todayCount ?? "–", caption: "Einträge heute" },
          { icon: "check", value: stats.data?.myTodayCount ?? "–", caption: "davon von dir" },
          {
            icon: "alert",
            value: stats.data?.withoutEntry.length ?? "–",
            caption: `${t.many} ohne Eintrag seit 24 h`,
            tone: "attention",
          },
          {
            icon: "calendar",
            value: (today.data?.entries ?? []).filter(
              (e) => e.importance === "important" || e.importance === "critical",
            ).length,
            caption: "für die Übergabe markiert",
            tone: "info",
          },
        ]}
      />
      <div className="documentation-quick-layout">
        <section className="card documentation-capture-card">
          {canWrite ? (
            <form className="area-editor-form doc-inline-form" onSubmit={submit}>
              <div className="area-editor-grid">
                <EntryFields draft={effective} onChange={changeDraft} residents={residents} lockResident />
              </div>
              {error && (
                <p className="appointment-editor-error" role="alert">
                  {error}
                </p>
              )}
              <footer className="area-editor-actions">
                {navigation.total > 1 && (
                  <button
                    className="secondary-button"
                    type="submit"
                    data-next="true"
                    disabled={saving || !effective.residentId}
                  >
                    Speichern &amp; nächster {t.one}
                  </button>
                )}
                <button className="primary-button" type="submit" disabled={saving || !effective.residentId}>
                  <ModuleIcon name="check" /> {saving ? "Speichern…" : "Eintrag speichern"}
                </button>
              </footer>
            </form>
          ) : (
            <EmptyState icon="note" title="Nur Lesezugriff" text="Deine Rolle darf keine Dokumentation erfassen." />
          )}
          <div className="documentation-today-header">
            <div>
              <p className="eyebrow">Letzte 24 Stunden</p>
              <h3>Einträge</h3>
            </div>
            <span className="status-badge stable">{today.data?.entries.length ?? 0} Einträge</span>
          </div>
          <div className="doc-entry-list">
            {(today.data?.entries ?? []).map((entry) => (
              <EntryItem key={entry.id} entry={entry} onAmend={canWrite ? setAmending : null} />
            ))}
            {!today.loading && !today.data?.entries.length && (
              <p className="list-hint">Noch keine Einträge in den letzten 24 Stunden.</p>
            )}
          </div>
        </section>
        <aside className="documentation-quick-aside">
          <section className="card doc-missing-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Aufmerksamkeit</p>
                <h2 className="card-title">Ohne Eintrag seit 24 h</h2>
              </div>
            </div>
            <ul>
              {(stats.data?.withoutEntry ?? []).map((resident) => (
                <li key={resident.id}>
                  <button type="button" onClick={() => changeDraft({ ...effective, residentId: resident.id })}>
                    <strong>
                      {resident.name} <ResuscitationBadge residentId={resident.id} />
                    </strong>
                    <small>
                      {resident.room ? `${resident.room} · ` : ""}
                      {resident.lastAt ? `zuletzt ${formatDateTime(resident.lastAt)}` : "noch nie dokumentiert"}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            {stats.data && !stats.data.withoutEntry.length && (
              <p className="list-hint">Alle {t.many} wurden in den letzten 24 Stunden dokumentiert.</p>
            )}
          </section>
          <section className="card documentation-period-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Letzte 7 Tage</p>
                <h2 className="card-title">Einträge pro Tag</h2>
              </div>
            </div>
            <div className="documentation-period-bars">
              {(stats.data?.perDay ?? []).map((day, index, all) => {
                const max = Math.max(...all.map((d) => d.count), 1);
                return (
                  <span
                    key={day.date}
                    className={index === all.length - 1 ? "active" : ""}
                    title={`${formatDate(day.date)}: ${day.count}`}
                  >
                    <i style={{ height: `${Math.max((day.count / max) * 100, 3)}%` }} />
                    <small>{day.date.slice(8, 10)}</small>
                  </span>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
      {amending && (
        <AmendDialog
          entry={amending}
          onClose={() => setAmending(null)}
          onSaved={(message) => {
            setAmending(null);
            showToast(message);
            reload();
          }}
        />
      )}
    </>
  );
}

const ALL_CATEGORIES = "Alle Arten";
const ALL_IMPORTANCE = "Jede Einordnung";

function HistoryView({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const residents = useResidents();
  const [residentId, setResidentId] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [importance, setImportance] = useState<Importance | "">("");
  const [days, setDays] = useState(7);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [amending, setAmending] = useState<DocEntry | null>(null);
  const params = new URLSearchParams({ days: String(days) });
  if (residentId) params.set("residentId", residentId);
  if (category !== ALL_CATEGORIES) params.set("category", category);
  if (importance) params.set("importance", importance);
  if (search) params.set("q", search);
  const data = useApiData<EntriesPayload>(`/api/documentation?${params}`);
  const entries = data.data?.entries ?? [];
  const label = (r: ResidentOption) => `${r.name}${r.room ? ` · ${r.room}` : ""}`;
  const done = (message: string) => {
    setCreating(false);
    setAmending(null);
    showToast(message);
    data.reload();
  };

  return (
    <>
      <PageHeading
        eyebrow="Dokumentation"
        title="Verlaufsdokumentation"
        description="Chronologischer Pflegeverlauf – Korrekturen erscheinen als Nachtrag, das Original bleibt nachvollziehbar."
        action={data.data?.canWrite ? { label: "Eintrag erfassen", onClick: () => setCreating(true) } : undefined}
      />
      <section className="card doc-filterbar">
        <CareSelect
          label={t.one}
          value={
            residents.find((r) => r.id === residentId)
              ? label(residents.find((r) => r.id === residentId)!)
              : `Alle ${t.many}`
          }
          options={[`Alle ${t.many}`, ...residents.map(label)]}
          onChange={(v) => setResidentId(residents.find((r) => label(r) === v)?.id ?? "")}
        />
        <CareSelect
          label="Dokumentationsart"
          value={category}
          options={[ALL_CATEGORIES, ...DOC_CATEGORIES]}
          onChange={setCategory}
        />
        <CareSelect
          label="Einordnung"
          value={importance ? IMPORTANCE[importance].label : ALL_IMPORTANCE}
          options={[ALL_IMPORTANCE, ...Object.values(IMPORTANCE).map((i) => i.label)]}
          onChange={(v) =>
            setImportance((Object.keys(IMPORTANCE) as Importance[]).find((k) => IMPORTANCE[k].label === v) ?? "")
          }
        />
        <div className="care-record-filters">
          {[1, 7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              className={days === d ? "active" : ""}
              aria-pressed={days === d}
              onClick={() => setDays(d)}
            >
              {d === 1 ? "24 h" : `${d} Tage`}
            </button>
          ))}
        </div>
        <form
          className="resident-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(query.trim());
          }}
        >
          <ModuleIcon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => setSearch(query.trim())}
            placeholder="Im Text suchen …"
            aria-label="Dokumentation durchsuchen"
          />
        </form>
      </section>
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <section className="card documentation-history-card">
        <div className="documentation-history-header">
          <div>
            <p className="eyebrow">Verlauf</p>
            <h2 className="card-title">{entries.length} Einträge</h2>
          </div>
        </div>
        <div className="doc-entry-list">
          {entries.map((entry) => (
            <EntryItem
              key={entry.id}
              entry={entry}
              onAmend={data.data?.canWrite ? setAmending : null}
              showResident={!residentId}
            />
          ))}
          {!data.loading && !entries.length && (
            <EmptyState icon="search" title="Keine Einträge gefunden" text="Filter oder Zeitraum anpassen." />
          )}
          {data.loading && !data.data && <p className="list-hint">Dokumentation wird geladen …</p>}
        </div>
      </section>
      {creating && (
        <EntryDialog
          residents={residents}
          residentId={residentId || undefined}
          onClose={() => setCreating(false)}
          onSaved={done}
        />
      )}
      {amending && <AmendDialog entry={amending} onClose={() => setAmending(null)} onSaved={done} />}
    </>
  );
}

export default function DocumentationWorkspace({ view }: { view: DocumentationView }) {
  return (
    <ModulePageShell
      activeModule="chart"
      activeChild={view === "quick" ? "Schnelldokumentation" : "Verlaufsdokumentation"}
      pageClass={`documentation-page documentation-${view}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace documentation-workspace">
          {view === "quick" ? <QuickView showToast={showToast} /> : <HistoryView showToast={showToast} />}
        </main>
      )}
    </ModulePageShell>
  );
}
