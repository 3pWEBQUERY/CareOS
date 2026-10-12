"use client";

import Link from "next/link";
import { useState } from "react";
import { useHeaderResident, useTerms, useWorkContext } from "@/app/components/care-context";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import ModulePageShell from "@/app/components/module-page-shell";
import { sendOrQueue } from "@/app/components/offline-queue";
import {
  EditorDialog,
  EmptyState,
  LoadError,
  PageHeading,
  ReasonDialog,
  SummaryTiles,
  formatDate,
  formatDateTime,
  requestJson,
  timeInZurich,
  todayInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { zurichTimeToIso } from "@/lib/resident-appointments";
import {
  POSITIONS,
  SKIN_FINDINGS,
  formatInterval,
  type Position,
  type RepositioningEntry,
  type RepositioningView as View,
  type SkinFinding,
} from "@/lib/repositioning-shared";

const POSITION_KEYS = Object.keys(POSITIONS) as Position[];
const SKIN_KEYS = Object.keys(SKIN_FINDINGS) as SkinFinding[];
const RANGES = [
  [24, "24 Stunden"],
  [72, "3 Tage"],
  [168, "7 Tage"],
] as const;

const timeOf = (iso: string) => timeInZurich(new Date(iso));
const dayOf = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date(iso)).slice(0, 10);

function EntryDialog({
  residentId,
  residentName,
  last,
  onClose,
  onSaved,
}: {
  residentId: string;
  residentName: string;
  last: Position | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [position, setPosition] = useState<Position | null>(null);
  const [skin, setSkin] = useState<SkinFinding | null>(null);
  const [time, setTime] = useState(timeInZurich);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!position) return setError("Bitte die Position wählen.");
    if (!skin) return setError("Bitte den Hautbefund wählen.");
    setSaving(true);
    setError("");
    try {
      const result = await sendOrQueue(
        "/api/repositioning",
        { residentId, position, skin, note, performedAt: zurichTimeToIso(todayInZurich(), time) },
        `Lagerung ${POSITIONS[position]} · ${residentName}`,
        { field: "note", label: "Bemerkung" },
      );
      onSaved(
        `${residentName}: ${POSITIONS[position]} erfasst${result.queued ? " (offline – wird gesendet, sobald die Verbindung zurück ist)" : ""}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="repositioning-entry"
      eyebrow={`${residentName} · ${formatDate(todayInZurich())}`}
      title="Positionswechsel erfassen"
      description={
        last
          ? `Bisher: ${POSITIONS[last]}. Neue Position und Hautbefund wählen.`
          : "Neue Position und Hautbefund wählen."
      }
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <fieldset className="area-editor-wide">
        <legend>Position</legend>
        <div className="repositioning-choices" role="group" aria-label="Position">
          {POSITION_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`day-toggle ${position === key ? "active" : ""}`}
              aria-pressed={position === key}
              onClick={() => setPosition(key)}
            >
              {POSITIONS[key]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="area-editor-wide">
        <legend>Hautbefund an den belasteten Stellen</legend>
        <div className="repositioning-choices" role="group" aria-label="Hautbefund">
          {SKIN_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`day-toggle ${skin === key ? "active" : ""}`}
              aria-pressed={skin === key}
              onClick={() => setSkin(key)}
            >
              {SKIN_FINDINGS[key]}
            </button>
          ))}
        </div>
        {skin === "broken" && (
          <p className="repositioning-hint">
            Eine Hautverletzung bitte zusätzlich im <Link href="/c/wundmanagement">Wundmanagement</Link> dokumentieren.
          </p>
        )}
      </fieldset>
      <label>
        <span>Uhrzeit</span>
        <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} />
      </label>
      <label className="area-editor-wide">
        <span>{position === "other" ? "Bemerkung (Position beschreiben)" : "Bemerkung (optional)"}</span>
        <input
          maxLength={2000}
          required={position === "other"}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
    </EditorDialog>
  );
}

function PlanDialog({
  residentId,
  residentName,
  view,
  onClose,
  onSaved,
}: {
  residentId: string;
  residentName: string;
  view: View;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const minutes = view.plan?.intervalMinutes ?? 0;
  const [hours, setHours] = useState(view.plan ? String(Math.floor(minutes / 60)) : "");
  const [rest, setRest] = useState(view.plan ? String(minutes % 60) : "0");
  const [interventionId, setInterventionId] = useState(view.plan?.interventionId ?? "");
  const [note, setNote] = useState(view.plan?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const interval = Number(hours || 0) * 60 + Number(rest || 0);
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/repositioning/plan", {
        method: "PUT",
        body: { residentId, intervalMinutes: interval, interventionId: interventionId || null, note },
      });
      onSaved(`Lagerungsplan für ${residentName} gespeichert`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="repositioning-plan"
      eyebrow={residentName}
      title={view.plan ? "Lagerungsplan ändern" : "Lagerungsplan festlegen"}
      description="Das Intervall stammt aus der Pflegeplanung bzw. der Einschätzung der Fachperson. CareOS gibt kein Intervall vor und berechnet daraus nur den nächsten Wechsel."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel="Speichern"
    >
      <label>
        <span>Intervall: Stunden</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={24}
          step={1}
          required
          value={hours}
          onChange={(event) => setHours(event.target.value)}
        />
      </label>
      <label>
        <span>und Minuten</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={59}
          step={5}
          value={rest}
          onChange={(event) => setRest(event.target.value)}
        />
      </label>
      <label className="area-editor-wide">
        <span>Massnahme der Pflegeplanung (optional)</span>
        <CareOptionSelect
          label="Massnahme der Pflegeplanung"
          value={interventionId}
          onChange={setInterventionId}
          options={[
            { value: "", label: "Ohne Bezug" },
            ...view.interventions.map((item) => ({
              value: item.id,
              label: [item.title, item.frequency].filter(Boolean).join(" · "),
            })),
          ]}
        />
      </label>
      <label className="area-editor-wide">
        <span>Hinweise (optional)</span>
        <input
          maxLength={2000}
          placeholder="z. B. Hilfsmittel, Positionen laut Planung"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
    </EditorDialog>
  );
}

function EntryItem({
  entry,
  onCancel,
}: {
  entry: RepositioningEntry;
  onCancel: ((entry: RepositioningEntry) => void) | null;
}) {
  const notable = entry.skin === "non_blanching" || entry.skin === "broken";
  return (
    <li className={entry.cancelled ? "cancelled" : ""}>
      <time dateTime={entry.performedAt}>{timeOf(entry.performedAt)}</time>
      <div>
        <strong>{POSITIONS[entry.position]}</strong>
        <small>
          <span className={notable ? "repositioning-skin notable" : "repositioning-skin"}>
            {SKIN_FINDINGS[entry.skin]}
          </span>
          {" · "}
          {entry.author}
        </small>
        {entry.note && <p>{entry.note}</p>}
        {entry.cancelled && <p className="service-cancel-reason">Storniert: {entry.cancelled.reason}</p>}
      </div>
      {onCancel && !entry.cancelled && (
        <button className="secondary-button" type="button" onClick={() => onCancel(entry)}>
          Stornieren
        </button>
      )}
    </li>
  );
}

function RepositioningContent({ showToast }: { showToast: ShowToast }) {
  const t = useTerms();
  const context = useWorkContext();
  const residents = context?.residents ?? [];
  const { resident, missing } = useHeaderResident(residents, !context);
  const [hours, setHours] = useState<number>(24);
  const [dialog, setDialog] = useState<"entry" | "plan" | "end" | null>(null);
  const [cancelling, setCancelling] = useState<RepositioningEntry | null>(null);
  const data = useApiData<View>(resident ? `/api/repositioning?residentId=${resident.id}&hours=${hours}` : null);
  const view = data.data?.residentId === resident?.id ? data.data : null;
  const canWrite = view?.canWrite ?? false;
  const done = (message: string) => {
    setDialog(null);
    setCancelling(null);
    showToast(message);
    data.reload();
  };
  const overdue = view?.overdue ?? false;
  const active = view?.entries.filter((entry) => !entry.cancelled) ?? [];
  const lastPosition = active[0]?.position ?? null;
  const days = [...new Set(view?.entries.map((entry) => dayOf(entry.performedAt)) ?? [])];

  return (
    <>
      <PageHeading
        eyebrow="Dokumentation"
        title="Lagerung & Bewegung"
        description={`Positionswechsel mit Hautbefund je ${t.one}. Das Intervall stammt aus der Pflegeplanung; die Tagesliste zeigt den nächsten Wechsel.`}
        action={
          resident && canWrite ? { label: "Positionswechsel erfassen", onClick: () => setDialog("entry") } : undefined
        }
      />
      {!resident ? (
        <HeaderResidentHint loading={!context} missing={missing} />
      ) : (
        <>
          <section className="service-toolbar">
            <div className="repositioning-range" role="group" aria-label="Zeitraum">
              {RANGES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`day-toggle ${hours === value ? "active" : ""}`}
                  aria-pressed={hours === value}
                  onClick={() => setHours(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p>
              {resident.name} · {resident.room}
            </p>
          </section>
          <SummaryTiles
            label="Lagerung"
            tiles={[
              {
                icon: "calendar",
                value: view?.nextDueAt ? timeOf(view.nextDueAt) : "–",
                caption: view?.plan ? (overdue ? "Wechsel fällig seit" : "nächster Wechsel") : "kein Lagerungsplan",
                tone: overdue ? "attention" : undefined,
              },
              {
                icon: "pulse",
                value: view?.plan ? formatInterval(view.plan.intervalMinutes) : "–",
                caption: "Intervall laut Plan",
              },
              {
                icon: "check",
                value: view ? active.length : "–",
                caption: `Wechsel (${RANGES.find(([v]) => v === hours)?.[1]})`,
              },
            ]}
          />
          {data.error && <LoadError message={data.error} onRetry={data.reload} />}
          <div className="service-layout">
            <section className="card service-records repositioning-entries" aria-label="Verlauf der Positionswechsel">
              <header>
                <h2 className="card-title">Verlauf</h2>
                <p className="card-subtitle">
                  {view?.lastAt ? `Letzter Wechsel ${formatDateTime(view.lastAt)}` : "Noch kein Wechsel erfasst"}
                </p>
              </header>
              {view && !view.entries.length ? (
                <EmptyState
                  icon="pulse"
                  title="Keine Positionswechsel"
                  text="Im gewählten Zeitraum ist kein Positionswechsel erfasst."
                />
              ) : (
                days.map((day) => (
                  <div key={day} className="repositioning-day">
                    <h3>{formatDate(day)}</h3>
                    <ul>
                      {view?.entries
                        .filter((entry) => dayOf(entry.performedAt) === day)
                        .map((entry) => (
                          <EntryItem key={entry.id} entry={entry} onCancel={canWrite ? setCancelling : null} />
                        ))}
                    </ul>
                  </div>
                ))
              )}
            </section>
            <section className="card service-suggestions repositioning-plan" aria-label="Lagerungsplan">
              <header>
                <h2 className="card-title">Lagerungsplan</h2>
                <p className="card-subtitle">
                  {!view
                    ? "Wird geladen …"
                    : view.plan
                      ? `Festgelegt ${formatDateTime(view.plan.createdAt)} · ${view.plan.createdBy}`
                      : "Noch kein Plan festgelegt"}
                </p>
              </header>
              {view?.plan ? (
                <dl>
                  <div>
                    <dt>Intervall</dt>
                    <dd>alle {formatInterval(view.plan.intervalMinutes)}</dd>
                  </div>
                  {view.plan.intervention && (
                    <div>
                      <dt>Massnahme</dt>
                      <dd>{view.plan.intervention}</dd>
                    </div>
                  )}
                  {view.plan.note && (
                    <div>
                      <dt>Hinweise</dt>
                      <dd>{view.plan.note}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="service-empty">
                  Ohne Plan werden Wechsel erfasst, aber nicht in der Tagesliste erinnert.
                </p>
              )}
              {canWrite && view && (
                <div className="occupancy-actions">
                  <button className="secondary-button" type="button" onClick={() => setDialog("plan")}>
                    {view.plan ? "Plan ändern" : "Plan festlegen"}
                  </button>
                  {view.plan && (
                    <button className="secondary-button" type="button" onClick={() => setDialog("end")}>
                      Plan beenden
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        </>
      )}
      {dialog === "entry" && resident && (
        <EntryDialog
          residentId={resident.id}
          residentName={resident.name}
          last={lastPosition}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog === "plan" && resident && view && (
        <PlanDialog
          residentId={resident.id}
          residentName={resident.name}
          view={view}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog === "end" && resident && (
        <ReasonDialog
          title="Lagerungsplan beenden"
          description="Danach erinnert die Tagesliste nicht mehr an Positionswechsel. Erfasste Wechsel bleiben erhalten."
          label="Grund"
          placeholder="z. B. wieder selbständig mobil"
          submitLabel="Plan beenden"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await requestJson("/api/repositioning/plan", {
              method: "DELETE",
              body: { residentId: resident.id, reason },
            });
            done("Lagerungsplan beendet");
          }}
        />
      )}
      {cancelling && (
        <ReasonDialog
          title="Positionswechsel stornieren"
          description={`„${POSITIONS[cancelling.position]}“ um ${timeOf(cancelling.performedAt)} bleibt sichtbar, zählt aber nicht mehr.`}
          label="Grund der Stornierung"
          placeholder="z. B. doppelt erfasst, falsche Person"
          submitLabel="Stornieren"
          danger
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            await requestJson(`/api/repositioning/${cancelling.id}/cancel`, { method: "POST", body: { reason } });
            done("Positionswechsel storniert");
          }}
        />
      )}
    </>
  );
}

// Dokumentation › Lagerung: Positionswechsel der Person in der Kopfzeile und ihr Lagerungsplan.
export default function RepositioningView() {
  return (
    <ModulePageShell
      activeModule="chart"
      activeChild="Lagerung"
      pageClass="documentation-page documentation-repositioning"
    >
      {(showToast) => (
        <main className="workspace module-workspace documentation-workspace">
          <RepositioningContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
