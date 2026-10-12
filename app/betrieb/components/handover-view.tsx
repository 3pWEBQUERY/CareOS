"use client";

import { useCareResident, useTerms } from "@/app/components/care-context";
import { useActionRequest } from "@/app/components/actions";
import { DictationButton, appendDictation } from "@/app/components/dictation-button";
import Link from "next/link";
import { useRef, useState } from "react";
import { CareSelect } from "@/app/components/care-form-controls";
import ModulePageShell from "@/app/components/module-page-shell";
import { type ModuleIconName } from "@/app/components/module-icon";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDateTime,
  requestJson,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import type { HandoverEvent, HandoverNote, HandoverSource } from "@/lib/handover";
import { sendOrQueue } from "@/app/components/offline-queue";

type Payload = {
  since: string;
  basis: string;
  careUnits: Array<{ id: string; name: string }>;
  events: HandoverEvent[];
  notes: HandoverNote[];
  canWrite: boolean;
};

const PERIODS = [
  { value: "last", label: "Seit meinem letzten Dienst" },
  { value: "8", label: "Letzte 8 Stunden" },
  { value: "12", label: "Letzte 12 Stunden" },
  { value: "24", label: "Letzte 24 Stunden" },
  { value: "48", label: "Letzte 48 Stunden" },
];
const SOURCES: Array<{ value: HandoverSource | "all" | "critical"; label: string }> = [
  { value: "all", label: "Alle" },
  { value: "critical", label: "Kritisch" },
  { value: "documentation", label: "Dokumentation" },
  { value: "vitals", label: "Vitalwerte" },
  { value: "medication", label: "Medikation" },
  { value: "wounds", label: "Wunden" },
  { value: "assessments", label: "Einschätzungen" },
  { value: "nutrition", label: "Ernährung" },
];
const sourceIcon: Record<HandoverSource, ModuleIconName> = {
  documentation: "note",
  vitals: "vitals",
  medication: "med",
  wounds: "wounds",
  assessments: "assess",
  nutrition: "nutrition",
};
const priorityLabel = { normal: "Normal", high: "Wichtig", critical: "Kritisch" } as const;
const priorityTone = { normal: "info", high: "attention", critical: "critical" } as const;
const ALL_UNITS = "Alle Wohnbereiche";

function HandoverContent({ lastShift, showToast }: { lastShift: boolean; showToast: ShowToast }) {
  const t = useTerms();
  const noResident = `Allgemein (kein ${t.one})`;
  const [period, setPeriod] = useState(lastShift ? "last" : "8");
  const [unitId, setUnitId] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]["value"]>("all");
  const params = new URLSearchParams({ period });
  if (unitId) params.set("careUnitId", unitId);
  const data = useApiData<Payload>(`/api/handover?${params}`);
  const residents = useApiData<{
    residents: Array<{ id: string; first_name: string; last_name: string; room: string }>;
  }>("/api/residents");
  const [draft, setDraft] = useState({ residentId: "", content: "", priority: "normal" as HandoverNote["priority"] });
  const [saving, setSaving] = useState(false);
  const [contextResident] = useCareResident();
  const contentField = useRef<HTMLTextAreaElement>(null);
  // Aktion „Übergabepunkt erfassen“: Person aus der Kopfzeile vorwählen und ins Textfeld springen.
  useActionRequest(
    "handover",
    () => {
      if (contextResident) setDraft((current) => ({ ...current, residentId: contextResident }));
      window.requestAnimationFrame(() => contentField.current?.focus());
    },
    !!data.data?.canWrite && !lastShift,
  );
  const events = data.data?.events ?? [];
  const notes = data.data?.notes ?? [];
  const unread = notes.filter((n) => !n.readByMe);
  const visible = events.filter(
    (e) => source === "all" || (source === "critical" ? e.tone === "critical" : e.source === source),
  );
  const residentOptions = (residents.data?.residents ?? []).map((r) => ({
    id: r.id,
    label: `${r.first_name} ${r.last_name}${r.room ? ` · ${r.room}` : ""}`,
  }));

  async function saveNote() {
    setSaving(true);
    try {
      const resident = residentOptions.find((option) => option.id === draft.residentId)?.label;
      const result = await sendOrQueue(
        "/api/handover",
        { ...draft, careUnitId: draft.residentId ? null : unitId || null, notedAt: new Date().toISOString() },
        `Übergabe${resident ? ` · ${resident}` : ""}`,
        { field: "content", label: "Übergabepunkt" },
      );
      showToast(
        result.queued
          ? "Übergabepunkt offline gespeichert – wird gesendet, sobald die Verbindung zurück ist"
          : "Übergabepunkt gespeichert",
      );
      setDraft({ residentId: "", content: "", priority: "normal" });
      data.reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }
  async function markRead(ids: string[]) {
    try {
      await Promise.all(ids.map((id) => requestJson(`/api/handover/${id}/read`, { method: "POST" })));
      showToast(ids.length === 1 ? "Als gelesen bestätigt" : `${ids.length} Übergabepunkte als gelesen bestätigt`);
      data.reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    }
  }
  const adopt = (event: HandoverEvent) =>
    setDraft({
      residentId: event.residentId,
      content: `${event.title}: ${event.detail}`.slice(0, 2000),
      priority: event.tone === "critical" ? "critical" : "high",
    });

  return (
    <>
      <PageHeading
        eyebrow="Übergabe"
        title={lastShift ? "Seit letztem Dienst" : "Meine Übergabe"}
        description={
          lastShift
            ? "Alle relevanten Veränderungen seit deinem letzten Dienst – automatisch aus Dokumentation, Vitalwerten, Medikation, Wunden, Einschätzungen und Ernährung."
            : "Übergabepunkte für den nächsten Dienst festhalten und offene Punkte der Kolleginnen und Kollegen bestätigen."
        }
        action={
          unread.length
            ? {
                label: `${unread.length} als gelesen bestätigen`,
                onClick: () => void markRead(unread.map((n) => n.id)),
              }
            : undefined
        }
      />
      <SummaryTiles
        label="Übergabe"
        tiles={[
          {
            icon: "handover",
            value: unread.length,
            caption: "ungelesene Übergabepunkte",
            tone: unread.length ? "attention" : undefined,
          },
          {
            icon: "alert",
            value: events.filter((e) => e.tone === "critical").length,
            caption: "kritische Ereignisse",
            tone: "critical",
          },
          { icon: "note", value: events.length, caption: "Ereignisse im Zeitraum" },
          {
            icon: "residents",
            value: new Set(events.map((e) => e.residentId)).size,
            caption: `betroffene ${t.many}`,
            tone: "info",
          },
        ]}
      />
      <section className="card handover-filterbar">
        <CareSelect
          label="Zeitraum"
          value={PERIODS.find((p) => p.value === period)?.label ?? PERIODS[0].label}
          options={PERIODS.map((p) => p.label)}
          onChange={(v) => setPeriod(PERIODS.find((p) => p.label === v)?.value ?? period)}
        />
        <CareSelect
          label="Wohnbereich"
          value={data.data?.careUnits.find((u) => u.id === unitId)?.name ?? ALL_UNITS}
          options={[ALL_UNITS, ...(data.data?.careUnits ?? []).map((u) => u.name)]}
          onChange={(v) => setUnitId(data.data?.careUnits.find((u) => u.name === v)?.id ?? "")}
        />
        <small>{data.data ? `Seit ${formatDateTime(data.data.since)} · ${data.data.basis}` : "Wird geladen …"}</small>
      </section>
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <div className="handover-layout">
        <section className="card handover-feed">
          <div className="operations-toolbar">
            <div>
              <h2 className="card-title">Automatisch erkannte Punkte</h2>
              <p className="card-subtitle">{visible.length} Ereignisse, kritische zuerst</p>
            </div>
            <div className="operations-filter-buttons">
              {SOURCES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={source === item.value ? "active" : ""}
                  aria-pressed={source === item.value}
                  onClick={() => setSource(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="handover-event-list">
            {visible.map((event) => (
              <article className={event.tone} key={event.id}>
                <time>{formatDateTime(event.occurredAt)}</time>
                <span className="operations-timeline-icon">
                  <ModuleIcon name={event.tone === "critical" ? "alert" : sourceIcon[event.source]} />
                </span>
                <div>
                  <strong>
                    {event.title} · {event.residentName}
                  </strong>
                  <p>{event.detail}</p>
                  <small>
                    {[event.room, event.author].filter(Boolean).join(" · ")}
                    {" · "}
                    <Link href={event.href}>Öffnen</Link>
                  </small>
                </div>
                {data.data?.canWrite && !lastShift ? (
                  <button
                    type="button"
                    title="Als Übergabepunkt übernehmen"
                    aria-label="Als Übergabepunkt übernehmen"
                    onClick={() => adopt(event)}
                  >
                    <ModuleIcon name="plus" />
                  </button>
                ) : (
                  <span />
                )}
              </article>
            ))}
            {!data.loading && !visible.length && (
              <EmptyState
                icon="check"
                title="Keine Ereignisse"
                text="Im gewählten Zeitraum gibt es nichts Auffälliges."
              />
            )}
            {data.loading && !data.data && <p className="list-hint">Übergabe wird geladen …</p>}
          </div>
        </section>
        <aside className="handover-side">
          {data.data?.canWrite && !lastShift && (
            <section className="card handover-editor">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Für den nächsten Dienst</p>
                  <h2 className="card-title">Übergabepunkt erfassen</h2>
                </div>
              </div>
              <CareSelect
                label={t.one}
                value={residentOptions.find((r) => r.id === draft.residentId)?.label ?? noResident}
                options={[noResident, ...residentOptions.map((r) => r.label)]}
                onChange={(v) =>
                  setDraft({ ...draft, residentId: residentOptions.find((r) => r.label === v)?.id ?? "" })
                }
              />
              <div className="care-record-filters" role="group" aria-label="Priorität">
                {(Object.keys(priorityLabel) as HandoverNote["priority"][]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={draft.priority === p ? "active" : ""}
                    aria-pressed={draft.priority === p}
                    onClick={() => setDraft({ ...draft, priority: p })}
                  >
                    {priorityLabel[p]}
                  </button>
                ))}
              </div>
              <textarea
                ref={contentField}
                value={draft.content}
                maxLength={2000}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                placeholder="Was muss der nächste Dienst wissen oder tun?"
                aria-label="Übergabepunkt"
              />
              <DictationButton
                onText={(text) =>
                  setDraft((current) => ({ ...current, content: appendDictation(current.content, text) }))
                }
              />
              <div className="handover-editor-footer">
                <span>{draft.content.length}/2000 Zeichen</span>
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving || draft.content.trim().length < 3}
                  onClick={() => void saveNote()}
                >
                  {saving ? "Speichern…" : "Speichern"}
                </button>
              </div>
            </section>
          )}
          <section className="card handover-notes">
            <div className="card-header">
              <div>
                <p className="eyebrow">Letzte 72 Stunden</p>
                <h2 className="card-title">Übergabepunkte</h2>
              </div>
              <span className={`status-badge ${unread.length ? "attention" : "stable"}`}>
                {unread.length} ungelesen
              </span>
            </div>
            <ul>
              {notes.map((note) => (
                <li key={note.id} className={note.readByMe ? "read" : ""}>
                  <header>
                    <span className={`status-badge ${priorityTone[note.priority]}`}>
                      {priorityLabel[note.priority]}
                    </span>
                    <strong>{note.residentName ?? note.careUnit ?? "Allgemein"}</strong>
                  </header>
                  <p>{note.content}</p>
                  <small>
                    {note.author ?? "unbekannt"} · {formatDateTime(note.createdAt)}
                    {note.readers.length ? ` · gelesen von ${note.readers.join(", ")}` : ""}
                  </small>
                  {!note.readByMe && (
                    <button className="secondary-button" type="button" onClick={() => void markRead([note.id])}>
                      <ModuleIcon name="check" /> Gelesen
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!data.loading && !notes.length && (
              <p className="list-hint">Keine Übergabepunkte in den letzten 72 Stunden.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

export default function HandoverWorkspace({ lastShift }: { lastShift: boolean }) {
  return (
    <ModulePageShell
      activeModule="handover"
      activeChild={lastShift ? "Seit letztem Dienst" : "Meine Übergabe"}
      pageClass={`operations-page operations-${lastShift ? "lastShift" : "handover"}`}
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace operations-command-workspace">
          <HandoverContent lastShift={lastShift} showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
