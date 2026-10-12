"use client";

import { useState } from "react";
import { Printer } from "@phosphor-icons/react";
import ModulePageShell from "@/app/components/module-page-shell";
import { CareDatePicker } from "@/app/components/care-form-controls";
import {
  EmptyState,
  LoadError,
  PageHeading,
  SummaryTiles,
  formatDate,
  requestJson,
  timeInZurich,
  useApiData,
  type ShowToast,
} from "@/app/components/workspace-ui";
import { TRANSPORT_LABELS } from "@/lib/resident-appointments";
import { OUTING_EVENTS, type Outing, type OutingDay, type OutingEvent } from "@/lib/outings-shared";

const time = (iso: string) => timeInZurich(new Date(iso));

function addDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Stand eines Termins ausser Haus für die Tagesliste.
export function outingState(outing: Outing) {
  if (outing.status === "cancelled") return "Abgesagt";
  if (outing.returned) return `Zurück ${time(outing.returned.at)}`;
  if (outing.departed) return `Unterwegs seit ${time(outing.departed.at)}`;
  return "Noch im Haus";
}

// Abholung, Transport und Begleitung in einer Zeile.
export function outingLogistics(outing: Outing) {
  return [
    outing.pickupAt ? `Abholung ${time(outing.pickupAt)}` : "",
    outing.transport ? TRANSPORT_LABELS[outing.transport] : "Transport nicht festgelegt",
    outing.transportNote,
    outing.escort ? `Begleitung: ${outing.escort}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function OutingsContent({ showToast }: { showToast: ShowToast }) {
  const [date, setDate] = useState("");
  const { data, error, reload } = useApiData<OutingDay>(`/api/appointments/outings${date ? `?date=${date}` : ""}`);
  const [busy, setBusy] = useState("");
  const day = data?.date ?? date;
  const active = (data?.outings ?? []).filter((outing) => outing.status !== "cancelled");

  async function mark(outing: Outing, event: OutingEvent) {
    setBusy(outing.id);
    try {
      await requestJson(`/api/appointments/${outing.id}/outing`, { method: "POST", body: { event } });
      reload();
      showToast(`${outing.residentName}: ${event === "undo" ? "Vermerk zurückgenommen" : OUTING_EVENTS[event]}`);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Kalender"
        title="Fahrdienst"
        description="Termine ausser Haus mit Abholung, Transport, Begleitung und mitzugebenden Unterlagen. Abfahrt und Rückkehr hier vermerken. Termine ausser Haus werden im Kalender erfasst."
      />
      {data && (
        <div className="outing-day-picker">
          <div className="repositioning-choices" role="group" aria-label="Tag">
            {[
              { label: "Heute", value: data.today },
              { label: "Morgen", value: addDays(data.today, 1) },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                className={`day-toggle ${day === item.value ? "active" : ""}`}
                aria-pressed={day === item.value}
                onClick={() => setDate(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <CareDatePicker label="Tag der Tagesliste" value={day} onChange={(value) => setDate(value)} />
          <button
            className="secondary-button outing-print"
            type="button"
            onClick={() => window.open(`/c/carecore-one/kalender/fahrdienst/druck?date=${data.date}`, "_blank")}
          >
            <Printer className="button-icon" /> Tagesliste drucken
          </button>
        </div>
      )}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <SummaryTiles
          label="Übersicht Fahrdienst"
          tiles={[
            { icon: "calendar", value: active.length, caption: `Termine ausser Haus am ${formatDate(data.date)}` },
            {
              icon: "residents",
              value: active.filter((outing) => outing.departed && !outing.returned).length,
              caption: "zurzeit unterwegs",
              tone: active.some((outing) => outing.departed && !outing.returned) ? "attention" : undefined,
            },
            {
              icon: "check",
              value: active.filter((outing) => outing.returned).length,
              caption: "zurück im Haus",
            },
          ]}
        />
      )}
      {data && !data.outings.length ? (
        <EmptyState
          icon="calendar"
          title="Keine Termine ausser Haus"
          text={`Am ${formatDate(data.date)} ist kein Termin ausser Haus erfasst. Im Kalender beim Termin „Termin ausser Haus“ wählen.`}
        />
      ) : data ? (
        <section className="card device-list" aria-label="Termine ausser Haus">
          <ul>
            {data.outings.map((outing) => (
              <li
                key={outing.id}
                className={outing.status === "cancelled" ? "retired" : outing.departed && !outing.returned ? "due" : ""}
                aria-label={`${outing.residentName}, ${outing.title}`}
              >
                <div>
                  <strong>
                    {time(outing.startsAt)} · {outing.residentName}
                    <span className="diagnosis-code">{outing.room || outing.careUnit || "ohne Zimmer"}</span>
                  </strong>
                  <small>{[outing.title, outing.category, outing.location].filter(Boolean).join(" · ")}</small>
                  <small>{outingLogistics(outing)}</small>
                  {outing.documents && <small>Mitgeben: {outing.documents}</small>}
                  {outing.notes && <small>Hinweis: {outing.notes}</small>}
                  <small className="device-due">
                    {outingState(outing)}
                    {outing.returned?.by
                      ? ` · vermerkt von ${outing.returned.by}`
                      : outing.departed?.by
                        ? ` · vermerkt von ${outing.departed.by}`
                        : ""}
                  </small>
                </div>
                {data.canWrite && outing.status !== "cancelled" && (
                  <span className="device-actions">
                    {!outing.departed && (
                      <button
                        type="button"
                        className="death-checklist-action"
                        disabled={busy === outing.id}
                        aria-label={`${outing.residentName}: abgefahren`}
                        onClick={() => void mark(outing, "departed")}
                      >
                        Abgefahren
                      </button>
                    )}
                    {outing.departed && !outing.returned && (
                      <button
                        type="button"
                        className="death-checklist-action"
                        disabled={busy === outing.id}
                        aria-label={`${outing.residentName}: zurück`}
                        onClick={() => void mark(outing, "returned")}
                      >
                        Zurück
                      </button>
                    )}
                    {outing.departed && (
                      <button
                        type="button"
                        className="death-checklist-action"
                        disabled={busy === outing.id}
                        aria-label={`${outing.residentName}: letzten Vermerk zurücknehmen`}
                        onClick={() => void mark(outing, "undo")}
                      >
                        Rückgängig
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        !error && <p className="record-export-note">Wird geladen …</p>
      )}
    </>
  );
}

// Kommunikation › Kalender › Fahrdienst: Tagesliste für den Empfang.
export default function OutingsView() {
  return (
    <ModulePageShell
      activeModule="one-calendar"
      activeChild="Fahrdienst"
      pageClass="outings-page"
      locationSecondary="Gesamtes Haus · alle Wohnbereiche"
    >
      {(showToast) => (
        <main className="workspace module-workspace">
          <OutingsContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
