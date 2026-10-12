"use client";

import { useState } from "react";
import { useTerms, useWorkContext } from "@/app/components/care-context";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  LoadError,
  PageHeading,
  ReasonDialog,
  SummaryTiles,
  formatDate,
  requestJson,
  timeInZurich,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  ACTIVITY_CATEGORIES,
  MAX_REPEAT_WEEKS,
  PARTICIPATION_KEYS,
  PARTICIPATION_STATUS,
  type Activity,
  type ActivityDetail,
  type ActivityWeek,
  type ParticipationStatus,
} from "@/lib/activities-shared";
import { zurichTimeToIso } from "@/lib/resident-appointments";

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

// Tage als „JJJJ-MM-TT“ ohne Zeitzonenverschiebung rechnen.
function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));
const timeOf = (iso: string) => timeInZurich(new Date(iso));
const endOf = (activity: Activity) =>
  timeInZurich(new Date(Date.parse(activity.startsAt) + activity.durationMinutes * 60_000));

type Draft = {
  title: string;
  category: string;
  careUnitId: string;
  day: string;
  time: string;
  durationMinutes: string;
  location: string;
  leader: string;
  description: string;
  repeatWeeks: string;
};

const draftOf = (activity: Activity | null, day: string, careUnitId: string): Draft => ({
  title: activity?.title ?? "",
  category: activity?.category ?? "Gesellschaft & Gespräch",
  careUnitId: activity ? (activity.careUnitId ?? "") : careUnitId,
  day: activity ? dayOf(activity.startsAt) : day,
  time: activity ? timeOf(activity.startsAt) : "14:30",
  durationMinutes: String(activity?.durationMinutes ?? 60),
  location: activity?.location ?? "",
  leader: activity?.leader ?? "",
  description: activity?.description ?? "",
  repeatWeeks: "1",
});

function ActivityDialog({
  activity,
  initial,
  leaders,
  onClose,
  onSaved,
}: {
  activity: Activity | null;
  initial: Draft;
  // Für die Leitung von Angeboten zugeteilte Mitarbeitende (Konfiguration der Administration).
  leaders: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const context = useWorkContext();
  const units = context?.careUnits ?? [];
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function submit() {
    setSaving(true);
    setError("");
    const body = {
      title: draft.title,
      category: draft.category,
      careUnitId: draft.careUnitId || null,
      startsAt: zurichTimeToIso(draft.day, draft.time),
      durationMinutes: Number(draft.durationMinutes),
      location: draft.location,
      leader: draft.leader,
      description: draft.description,
      repeatWeeks: Number(draft.repeatWeeks),
    };
    try {
      if (activity) await requestJson(`/api/activities/${activity.id}`, { method: "PATCH", body });
      else await requestJson("/api/activities", { method: "POST", body });
      onSaved(
        activity
          ? "Angebot gespeichert"
          : Number(draft.repeatWeeks) > 1
            ? `Angebot für ${draft.repeatWeeks} Wochen geplant`
            : "Angebot geplant",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="activity"
      eyebrow="Alltag & Aktivierung"
      title={activity ? "Angebot bearbeiten" : "Angebot planen"}
      description="Gruppenangebot oder Einzelbetreuung für einen Wohnbereich oder das ganze Haus."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label className="area-editor-wide">
        <span>Angebot</span>
        <input
          required
          maxLength={160}
          value={draft.title}
          onChange={(event) => set("title", event.target.value)}
          placeholder="z. B. Singnachmittag, Gedächtnistraining, Spaziergang"
        />
      </label>
      <label>
        <span>Kategorie</span>
        <CareOptionSelect
          label="Kategorie"
          value={draft.category}
          onChange={(value) => set("category", value)}
          options={ACTIVITY_CATEGORIES.map((category) => ({ value: category, label: category }))}
        />
      </label>
      <label>
        <span>Für</span>
        <CareOptionSelect
          label="Für"
          value={draft.careUnitId}
          onChange={(value) => set("careUnitId", value)}
          options={[
            { value: "", label: "Ganzes Haus" },
            ...units.map((unit) => ({ value: unit.id, label: unit.name })),
          ]}
        />
      </label>
      <label>
        <span>Datum</span>
        <CareDatePicker label="Datum" value={draft.day} onChange={(value) => set("day", value)} />
      </label>
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={draft.time} onChange={(event) => set("time", event.target.value)} />
      </label>
      <label>
        <span>Dauer (Minuten)</span>
        <input
          required
          type="number"
          inputMode="numeric"
          min={5}
          max={600}
          step={5}
          value={draft.durationMinutes}
          onChange={(event) => set("durationMinutes", event.target.value)}
        />
      </label>
      {!activity && (
        <label>
          <span>Wiederholen</span>
          <CareOptionSelect
            label="Wiederholen"
            value={draft.repeatWeeks}
            onChange={(value) => set("repeatWeeks", value)}
            options={Array.from({ length: MAX_REPEAT_WEEKS }, (_, index) => ({
              value: String(index + 1),
              label: index ? `Wöchentlich, ${index + 1} Wochen` : "Nur einmal",
            }))}
          />
        </label>
      )}
      <label>
        <span>Ort (optional)</span>
        <input maxLength={160} value={draft.location} onChange={(event) => set("location", event.target.value)} />
      </label>
      <label>
        <span>Leitung (optional)</span>
        <CareOptionSelect
          label="Leitung (optional)"
          value={draft.leader}
          onChange={(value) => set("leader", value)}
          options={[
            { value: "", label: "Keine Angabe" },
            // Eine früher erfasste Leitung bleibt wählbar.
            ...(draft.leader && !leaders.includes(draft.leader) ? [{ value: draft.leader, label: draft.leader }] : []),
            ...leaders.map((name) => ({ value: name, label: name })),
          ]}
        />
        {!leaders.length && (
          <small className="activity-leader-hint">
            Noch niemand für die Leitung von Angeboten zugeteilt. Die Administration legt das unter Leitung ›
            Administration › Konfiguration fest.
          </small>
        )}
      </label>
      <label className="area-editor-wide">
        <span>Beschreibung (optional)</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </label>
    </EditorDialog>
  );
}

type Entry = { status: ParticipationStatus | null; note: string };

function ParticipationDialog({
  activityId,
  onClose,
  onSaved,
}: {
  activityId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTerms();
  const data = useApiData<ActivityDetail>(`/api/activities/${activityId}`);
  // Änderungen gegenüber der gespeicherten Teilnahme.
  const [changes, setChanges] = useState<Record<string, Entry>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const detail = data.data;
  const entryOf = (id: string): Entry => {
    const person = detail?.participants.find((item) => item.residentId === id);
    return changes[id] ?? { status: person?.status ?? null, note: person?.note ?? "" };
  };
  const update = (id: string, change: Partial<Entry>) =>
    setChanges((current) => ({ ...current, [id]: { ...entryOf(id), ...change } }));

  async function submit() {
    if (!detail) return;
    setSaving(true);
    setError("");
    try {
      await requestJson(`/api/activities/${activityId}/participation`, {
        method: "POST",
        body: {
          entries: Object.keys(changes).map((residentId) => ({ residentId, ...entryOf(residentId) })),
        },
      });
      onSaved("Teilnahme gespeichert");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="activity-participation"
      eyebrow={
        detail
          ? `${formatDate(detail.activity.startsAt)} · ${timeOf(detail.activity.startsAt)}`
          : "Alltag & Aktivierung"
      }
      title="Teilnahme erfassen"
      description={detail ? detail.activity.title : "Wird geladen …"}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error || data.error || ""}
      submitLabel="Teilnahme speichern"
    >
      <ul className="participation-list area-editor-wide">
        {detail?.participants.map((person) => {
          const entry = entryOf(person.residentId);
          return (
            <li key={person.residentId}>
              <div className="participation-person">
                <strong>{person.name}</strong>
                <small>{[person.room, person.careUnit].filter(Boolean).join(" · ")}</small>
              </div>
              <div className="participation-status" role="group" aria-label={`Teilnahme ${person.name}`}>
                {PARTICIPATION_KEYS.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`day-toggle ${entry.status === status ? "active" : ""}`}
                    aria-pressed={entry.status === status}
                    onClick={() => update(person.residentId, { status: entry.status === status ? null : status })}
                  >
                    {PARTICIPATION_STATUS[status]}
                  </button>
                ))}
              </div>
              {entry.status && (
                <input
                  className="participation-note"
                  maxLength={1000}
                  value={entry.note}
                  onChange={(event) => update(person.residentId, { note: event.target.value })}
                  placeholder="Bemerkung (optional), z. B. hat mitgesungen"
                  aria-label={`Bemerkung ${person.name}`}
                />
              )}
            </li>
          );
        })}
        {detail && !detail.participants.length && <li>Keine {t.many} in diesem Bereich.</li>}
      </ul>
    </EditorDialog>
  );
}

function ActivityCard({
  activity,
  canWrite,
  onParticipation,
  onEdit,
  onCancel,
}: {
  activity: Activity;
  canWrite: boolean;
  onParticipation: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const started = activity.started;
  const recorded = activity.counts.participated + activity.counts.declined + activity.counts.absent;
  return (
    <article className={`activity-card ${activity.cancelledAt ? "cancelled" : ""}`}>
      <div className="activity-time">
        <strong>{timeOf(activity.startsAt)}</strong>
        <small>bis {endOf(activity)}</small>
      </div>
      <div className="activity-body">
        <strong>{activity.title}</strong>
        <small>
          {[activity.category, activity.careUnit ?? "Ganzes Haus", activity.location, activity.leader]
            .filter(Boolean)
            .join(" · ")}
        </small>
        {activity.description && <p>{activity.description}</p>}
        {activity.cancelledAt ? (
          <p className="activity-cancelled">Abgesagt: {activity.cancelReason}</p>
        ) : (
          recorded > 0 && (
            <p className="activity-counts">
              {activity.counts.participated} teilgenommen · {activity.counts.declined} abgelehnt ·{" "}
              {activity.counts.absent} nicht anwesend
            </p>
          )
        )}
      </div>
      {canWrite && !activity.cancelledAt && (
        <div className="activity-actions">
          {started && (
            <button className="secondary-button" type="button" onClick={onParticipation}>
              Teilnahme erfassen
            </button>
          )}
          <button className="secondary-button" type="button" onClick={onEdit}>
            Bearbeiten
          </button>
          {!started && (
            <button className="secondary-button" type="button" onClick={onCancel}>
              Absagen
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function ActivitiesContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const context = useWorkContext();
  const units = context?.careUnits ?? [];
  const [day, setDay] = useState(todayInZurich);
  const [unitId, setUnitId] = useState("");
  const [editing, setEditing] = useState<{ activity: Activity | null; draft: Draft } | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Activity | null>(null);
  const params = new URLSearchParams({ day });
  if (unitId) params.set("careUnitId", unitId);
  const data = useApiData<ActivityWeek>(`/api/activities?${params}`);
  const week = data.data;
  const activities = week?.activities ?? [];
  const canWrite = week?.canWrite ?? false;
  const days = week ? Array.from({ length: 7 }, (_, index) => addDays(week.from, index)) : [];
  const done = (message: string) => {
    setEditing(null);
    setRecording(null);
    showToast(message);
    data.reload();
  };
  const active = activities.filter((item) => !item.cancelledAt);
  const participated = active.reduce((sum, item) => sum + item.counts.participated, 0);

  return (
    <>
      <PageHeading
        eyebrow="Alltag & Aktivierung"
        title="Angebote"
        description={`Gruppenangebote und Einzelbetreuung planen und die Teilnahme je ${t.one} festhalten.`}
        action={
          canWrite
            ? {
                label: "Angebot planen",
                onClick: () => setEditing({ activity: null, draft: draftOf(null, todayInZurich(), unitId) }),
              }
            : undefined
        }
      />
      <section className="activities-toolbar">
        <div className="activities-week" role="group" aria-label="Woche wählen">
          <button
            className="secondary-button"
            type="button"
            aria-label="Vorherige Woche"
            onClick={() => setDay(addDays(week?.from ?? day, -7))}
          >
            <ModuleIcon name="chevron" className="button-icon flip" />
          </button>
          <strong>{week ? `${formatDate(week.from)} – ${formatDate(addDays(week.to, -1))}` : "…"}</strong>
          <button
            className="secondary-button"
            type="button"
            aria-label="Nächste Woche"
            onClick={() => setDay(addDays(week?.from ?? day, 7))}
          >
            <ModuleIcon name="chevron" className="button-icon" />
          </button>
          <button className="secondary-button" type="button" onClick={() => setDay(todayInZurich())}>
            Diese Woche
          </button>
        </div>
        <CareOptionSelect
          label="Wohnbereich"
          value={unitId}
          onChange={setUnitId}
          options={[
            { value: "", label: "Alle Wohnbereiche" },
            ...units.map((unit) => ({ value: unit.id, label: unit.name })),
          ]}
        />
      </section>
      <SummaryTiles
        label="Woche"
        tiles={[
          { icon: "calendar", value: week ? active.length : "–", caption: "Angebote in der Woche" },
          { icon: "check", value: week ? participated : "–", caption: "Teilnahmen erfasst" },
          { icon: "alert", value: week ? activities.length - active.length : "–", caption: "abgesagt" },
        ]}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <div className="activities-days">
        {days.map((date, index) => {
          const own = activities.filter((item) => dayOf(item.startsAt) === date);
          return (
            <section
              className={`card activities-day ${date === todayInZurich() ? "today" : ""}`}
              key={date}
              aria-label={`${WEEKDAYS[index]}, ${formatDate(date)}`}
            >
              <header>
                <h2 className="card-title">{WEEKDAYS[index]}</h2>
                <p className="card-subtitle">{formatDate(date)}</p>
              </header>
              <div className="activities-day-list">
                {own.length ? (
                  own.map((item) => (
                    <ActivityCard
                      key={item.id}
                      activity={item}
                      canWrite={canWrite}
                      onParticipation={() => setRecording(item.id)}
                      onEdit={() => setEditing({ activity: item, draft: draftOf(item, date, unitId) })}
                      onCancel={() => setCancelling(item)}
                    />
                  ))
                ) : (
                  <p className="activities-empty">Keine Angebote</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {editing && (
        <ActivityDialog
          activity={editing.activity}
          initial={editing.draft}
          leaders={week?.leaders ?? []}
          onClose={() => setEditing(null)}
          onSaved={done}
        />
      )}
      {recording && <ParticipationDialog activityId={recording} onClose={() => setRecording(null)} onSaved={done} />}
      {cancelling && (
        <ReasonDialog
          eyebrow="Alltag & Aktivierung"
          title="Angebot absagen"
          description={`„${cancelling.title}“ am ${formatDate(cancelling.startsAt)} um ${timeOf(cancelling.startsAt)} wird abgesagt und bleibt mit dem Grund sichtbar.`}
          label="Grund der Absage"
          placeholder="z. B. Leitung erkrankt, Ausbruch im Wohnbereich"
          submitLabel="Absagen"
          danger
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/activities/${cancelling.id}/cancel`, { method: "POST", body: { reason } });
            setCancelling(null);
            showToast("Angebot abgesagt");
            data.reload();
          }}
        />
      )}
    </>
  );
}

// Alltag & Aktivierung › Angebote: Wochenplan mit Teilnahme.
export default function ActivitiesView() {
  return (
    <ModulePageShell activeModule="activities" activeChild="Angebote" pageClass="activities-page">
      {(showToast) => (
        <main className="workspace module-workspace activities-workspace">
          <ActivitiesContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
