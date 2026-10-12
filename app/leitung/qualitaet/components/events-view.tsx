"use client";

import { useMemo, useState } from "react";
import { ModuleIcon, type ModuleIconName } from "@/app/components/module-icon";
import { LoadError, formatDateTime, useApiData, type ShowToast } from "@/app/components/workspace-ui";
import {
  EVENT_STATUS,
  SEVERITIES,
  type EventStatus,
  type QualityEvent,
  type QualityEventsPayload,
} from "@/lib/quality-shared";
import { LeadershipHeading, LeadershipKpis, initialsOf } from "../../components/leadership-page-parts";
import { ActionDialog, HandleEventDialog, ReportEventDialog } from "./quality-dialogs";
import { EventTypesEditor } from "./event-types-editor";
import { WorkflowEditor } from "./workflow-editor";

const typeIcons: Record<string, ModuleIconName> = {
  Sturz: "alert",
  Medikation: "med",
  Dekubitus: "wounds",
  "Hygiene / Infektion": "quality",
  Beschwerde: "note",
  Lob: "check",
};
const FILTERS = ["Offen", "Abgeschlossen", "Alle"] as const;
type Filter = (typeof FILTERS)[number];
const isOpen = (event: QualityEvent) => event.status === "open" || event.status === "investigating";
const nextStatus: Partial<Record<EventStatus, EventStatus>> = {
  open: "investigating",
  investigating: "resolved",
  resolved: "closed",
};
const nextLabel: Partial<Record<EventStatus, string>> = {
  open: "Prüfung starten",
  investigating: "Massnahmen umgesetzt",
  resolved: "Abschliessen",
};

type Dialog =
  | { kind: "report" }
  | { kind: "handle"; event: QualityEvent; status: EventStatus }
  | { kind: "action"; event: QualityEvent }
  | { kind: "workflows" }
  | { kind: "types" }
  | null;

export default function EventsView({ showToast }: { showToast: ShowToast }) {
  const data = useApiData<QualityEventsPayload>("/api/quality/events");
  const [filter, setFilter] = useState<Filter>("Offen");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const events = useMemo(() => data.data?.events ?? [], [data.data]);
  const visible = useMemo(
    () =>
      events.filter(
        (event) =>
          (filter === "Alle" || (filter === "Offen") === isOpen(event)) &&
          `${event.title} ${event.type} ${event.description} ${event.residentName ?? ""} ${event.careUnit ?? ""}`
            .toLocaleLowerCase("de-CH")
            .includes(query.trim().toLocaleLowerCase("de-CH")),
      ),
    [events, filter, query],
  );
  const selected = events.find((event) => event.id === selectedId) ?? visible[0] ?? null;
  const stats = data.data?.stats;
  const canManage = data.data?.canManage ?? false;
  const year = new Date().getFullYear();
  const delta = stats && stats.lastYearSamePeriod ? stats.thisYear - stats.lastYearSamePeriod : null;
  const done = (message: string) => {
    setDialog(null);
    showToast(message);
    data.reload();
  };
  const openCount = events.filter(isOpen).length;
  const closedCount = events.length - openCount;

  return (
    <>
      <LeadershipHeading
        eyebrow="Qualität"
        title="Ereignisse"
        description={
          canManage
            ? "Sicherheitslage, Meldungen und Ursachen im gesamten Haus."
            : "Deine Meldungen an das Qualitätsmanagement."
        }
        action={{ label: "Ereignis melden", onClick: () => setDialog({ kind: "report" }) }}
      />
      <LeadershipKpis
        kpis={[
          {
            value: String(stats?.thisYear ?? "–"),
            label: `Ereignisse ${year}`,
            note: delta === null ? "kein Vorjahresvergleich" : `${delta > 0 ? "+" : ""}${delta} zum Vorjahreszeitraum`,
            tone: delta !== null && delta > 0 ? "attention" : "stable",
          },
          {
            value: String(stats?.criticalOpen ?? "–"),
            label: "kritisch offen",
            note: stats?.criticalOpen ? "sofortige Prüfung" : "keine offenen",
            tone: stats?.criticalOpen ? "critical" : "stable",
          },
          {
            value: String(stats?.investigating ?? "–"),
            label: "in Prüfung",
            note: `${stats?.newToday ?? 0} heute gemeldet`,
            tone: "attention",
          },
          {
            value: stats?.closedShare === null || !stats ? "–" : `${stats.closedShare} %`,
            label: "abgeschlossen",
            note: `${year} · Ziel 90 %`,
            tone: "info",
          },
        ]}
      />
      {data.error && <LoadError message={data.error} onRetry={data.reload} />}
      <div className="quality-events-layout">
        <section className="card quality-events-timeline">
          <div className="card-header">
            <div>
              <p className="eyebrow">Sicherheitsmonitor</p>
              <h2 className="card-title">Ereignisverlauf</h2>
              <p className="card-subtitle">
                {data.loading && !data.data
                  ? "Ereignisse werden geladen …"
                  : `${visible.length} von ${events.length} Meldungen`}
              </p>
            </div>
            <label className="resident-search">
              <ModuleIcon name="search" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Suchen…"
                aria-label="Ereignisse durchsuchen"
              />
            </label>
          </div>
          <div className="care-record-filters quality-filters" aria-label="Ereignisse filtern">
            {FILTERS.map((item) => (
              <button
                className={filter === item ? "active" : ""}
                type="button"
                key={item}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item} {item === "Offen" ? `(${openCount})` : item === "Abgeschlossen" ? `(${closedCount})` : ""}
              </button>
            ))}
          </div>
          <div className="quality-timeline-list">
            {visible.map((event) => (
              <article key={event.id} className={selected?.id === event.id ? "selected" : ""}>
                <div className={`quality-timeline-marker ${SEVERITIES[event.severity].tone}`}>
                  <ModuleIcon name={typeIcons[event.type] ?? "quality"} />
                </div>
                <div>
                  <p className="eyebrow">
                    {formatDateTime(event.occurredAt)} · {event.type}
                  </p>
                  <h3>{event.title}</h3>
                  <p>{event.description}</p>
                  <small>
                    {[event.residentName, event.careUnit, event.reportedBy && `gemeldet von ${event.reportedBy}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </div>
                <span className={`status-badge ${EVENT_STATUS[event.status].tone}`}>
                  {EVENT_STATUS[event.status].label}
                </span>
                <button className="quiet-button" type="button" onClick={() => setSelectedId(event.id)}>
                  {canManage ? "Prüfen" : "Ansehen"}
                </button>
              </article>
            ))}
            {!data.loading && visible.length === 0 && (
              <div className="resident-empty">
                <ModuleIcon name="check" />
                <strong>
                  {events.length ? "Keine Ereignisse in dieser Ansicht" : "Noch keine Ereignisse gemeldet"}
                </strong>
                <p>
                  {events.length ? "Filter oder Suchbegriff anpassen." : "Meldungen erscheinen hier chronologisch."}
                </p>
              </div>
            )}
          </div>
        </section>
        <aside className="house-history-sidebar">
          {selected && (
            <section className="card quality-action-detail">
              <div className="card-header">
                <div>
                  <p className="eyebrow">
                    Ereignis · {selected.type} · {SEVERITIES[selected.severity].label}
                  </p>
                  <h2 className="card-title">{selected.title}</h2>
                </div>
                <span className={`status-badge ${EVENT_STATUS[selected.status].tone}`}>
                  {EVENT_STATUS[selected.status].label}
                </span>
              </div>
              <div className="quality-action-owner">
                <span className="avatar">{selected.ownerName ? initialsOf(selected.ownerName) : "–"}</span>
                <span>
                  <strong>{selected.ownerName ?? "Noch nicht zugewiesen"}</strong>
                  <small>Verantwortlich</small>
                </span>
              </div>
              <p>{selected.description}</p>
              <dl>
                <div>
                  <dt>Zeitpunkt</dt>
                  <dd>{formatDateTime(selected.occurredAt)}</dd>
                </div>
                <div>
                  <dt>Betroffen</dt>
                  <dd>{[selected.residentName, selected.careUnit].filter(Boolean).join(" · ") || "–"}</dd>
                </div>
                <div>
                  <dt>Sofortmassnahmen</dt>
                  <dd>{selected.immediateAction ?? "–"}</dd>
                </div>
                <div>
                  <dt>Massnahmen</dt>
                  <dd>
                    {selected.actions ? `${selected.actions} geplant · ${selected.openActions} offen` : "Keine geplant"}
                  </dd>
                </div>
                {selected.followUps > 0 && (
                  <div>
                    <dt>Folgeaufgaben</dt>
                    <dd>
                      <a href="/c/betrieb/aufgaben/team">
                        {selected.followUpsDone} von {selected.followUps} erledigt
                      </a>
                    </dd>
                  </div>
                )}
                {selected.resolution && (
                  <div>
                    <dt>Ergebnis</dt>
                    <dd>{selected.resolution}</dd>
                  </div>
                )}
              </dl>
              {canManage && (
                <div className="quality-detail-actions">
                  {nextStatus[selected.status] && (
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() =>
                        setDialog({ kind: "handle", event: selected, status: nextStatus[selected.status]! })
                      }
                    >
                      {nextLabel[selected.status]}
                    </button>
                  )}
                  {selected.status !== "closed" && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setDialog({ kind: "action", event: selected })}
                    >
                      <ModuleIcon name="plus" /> Massnahme planen
                    </button>
                  )}
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setDialog({ kind: "handle", event: selected, status: selected.status })}
                  >
                    Bearbeiten
                  </button>
                </div>
              )}
            </section>
          )}
          {canManage && (
            <section className="card quality-workflow-card">
              <div className="card-header">
                <div>
                  <p className="eyebrow">Ablaufketten</p>
                  <h2 className="card-title">Folgeaufgaben nach Ereignissen</h2>
                </div>
              </div>
              <p>
                {Object.keys(data.data?.workflowSteps ?? {}).length
                  ? Object.entries(data.data?.workflowSteps ?? {})
                      .map(([type, count]) => `${type}: ${count} ${count === 1 ? "Schritt" : "Schritte"}`)
                      .join(" · ")
                  : "Noch keine Ablaufkette festgelegt."}
              </p>
              <p>
                {data.data?.eventTypes.custom.length
                  ? `Eigene Ereignisarten: ${data.data.eventTypes.custom.join(", ")}`
                  : "Keine eigenen Ereignisarten."}
              </p>
              <div className="quality-workflow-actions">
                <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "workflows" })}>
                  Ablaufketten festlegen
                </button>
                <button className="secondary-button" type="button" onClick={() => setDialog({ kind: "types" })}>
                  Ereignisarten
                </button>
              </div>
            </section>
          )}
          <section className="card quality-risk-card">
            <div className="card-header">
              <div>
                <p className="eyebrow">Risikobild</p>
                <h2 className="card-title">Sicherheitslage</h2>
              </div>
              <span className="quality-risk-score">
                {stats?.criticalOpen ? "C" : (stats?.closedShare ?? 100) >= 90 ? "A" : "B"}
              </span>
            </div>
            <div className="quality-risk-meter">
              <span style={{ width: `${stats?.closedShare ?? 0}%` }} />
            </div>
            <p>
              {stats?.closedShare === null || !stats
                ? `Noch keine Meldungen in ${year}.`
                : `${stats.closedShare} % der Meldungen aus ${year} sind abgeschlossen oder mit umgesetzten Massnahmen versehen.`}
            </p>
            <div className="quality-risk-stats">
              <span>
                <strong>{stats?.criticalOpen ?? 0}</strong>
                <small>Kritisch offen</small>
              </span>
              <span>
                <strong>{stats?.investigating ?? 0}</strong>
                <small>In Prüfung</small>
              </span>
              <span>
                <strong>{closedCount}</strong>
                <small>Abgeschlossen</small>
              </span>
            </div>
          </section>
        </aside>
      </div>
      {dialog?.kind === "report" && data.data && (
        <ReportEventDialog
          residents={data.data.residents}
          careUnits={data.data.careUnits}
          workflowSteps={data.data.workflowSteps}
          eventTypes={[...data.data.eventTypes.builtIn, ...data.data.eventTypes.custom]}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === "workflows" && <WorkflowEditor onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "types" && data.data && (
        <EventTypesEditor
          builtIn={data.data.eventTypes.builtIn}
          custom={data.data.eventTypes.custom}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === "handle" && (
        <HandleEventDialog
          event={dialog.event}
          status={dialog.status}
          staff={data.data?.staff ?? []}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === "action" && (
        <ActionDialog
          action={null}
          eventId={dialog.event.id}
          events={[{ id: dialog.event.id, name: dialog.event.title }]}
          careUnits={data.data?.careUnits ?? []}
          staff={data.data?.staff ?? []}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
    </>
  );
}
