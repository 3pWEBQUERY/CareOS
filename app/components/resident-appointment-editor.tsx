"use client";

import { useTerms } from "@/app/components/care-context";
import { useState, type FormEvent } from "react";
import { CalendarDots, Check, ClipboardText, Trash, X } from "@phosphor-icons/react";
import { CareDatePicker, CareSelect } from "@/app/components/care-form-controls";
import {
  appointmentCategories,
  careUnitTaskCategories,
  draftFromAppointment,
  initialAppointmentDraft,
  TRANSPORT_LABELS,
  zurichTimeToIso,
  type AppointmentCareUnit,
  type AppointmentDraft,
  type AppointmentKind,
  type AppointmentResident,
  type AppointmentTransport,
  type ResidentAppointment,
} from "@/lib/resident-appointments";
import { useEscapeClose } from "@/app/components/use-escape-close";

const times = Array.from(
  { length: 96 },
  (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`,
);
const statusLabels = { scheduled: "Geplant", completed: "Abgeschlossen", cancelled: "Abgesagt" } as const;
const NO_PICKUP = "Keine Abholung";
const NO_TRANSPORT = "Nicht festgelegt";

export default function ResidentAppointmentEditor({
  appointment,
  residents,
  careUnits = [],
  residentId,
  initialDraft,
  onClose,
  onSaved,
}: {
  appointment?: ResidentAppointment | null;
  residents: AppointmentResident[];
  careUnits?: AppointmentCareUnit[];
  residentId?: string;
  initialDraft?: AppointmentDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTerms();
  const [draft, setDraft] = useState<AppointmentDraft>(() =>
    appointment ? draftFromAppointment(appointment) : (initialDraft ?? initialAppointmentDraft(residentId)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEscapeClose(() => !saving && onClose());
  const residentOptions = residents.map((item) => ({
    ...item,
    label: `${item.name} · ${item.room_name || item.care_unit_name || "ohne Zimmer"}`,
  }));
  const selectedResident = residentOptions.find((item) => item.id === draft.residentId);
  const selectedCareUnit = careUnits.find((item) => item.id === draft.careUnitId);
  const update = <K extends keyof AppointmentDraft>(key: K, value: AppointmentDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const changeKind = (kind: AppointmentKind) =>
    setDraft((current) => ({
      ...current,
      kind,
      residentId: kind === "resident" ? current.residentId : "",
      careUnitId: kind === "care_unit_task" ? current.careUnitId : "",
      category: kind === "resident" ? appointmentCategories[0] : careUnitTaskCategories[0],
      outside: kind === "resident" ? current.outside : false,
    }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const startsAt = zurichTimeToIso(draft.date, draft.startTime);
    const endsAt = zurichTimeToIso(draft.date, draft.endTime);
    if (draft.kind === "resident" && !draft.residentId) {
      setError(`Bitte einen ${t.oneOblique} auswählen.`);
      return;
    }
    if (draft.kind === "care_unit_task" && !draft.careUnitId) {
      setError("Bitte einen Wohnbereich auswählen.");
      return;
    }
    if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
      setError("Bitte einen gültigen Zeitraum mit Endzeit nach der Startzeit wählen.");
      return;
    }
    const outside = draft.kind === "resident" && draft.outside;
    const pickupAt = outside && draft.pickupTime ? zurichTimeToIso(draft.date, draft.pickupTime) : "";
    if (pickupAt && Date.parse(pickupAt) >= Date.parse(endsAt)) {
      setError("Die Abholung muss vor dem Terminende liegen.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(appointment ? `/api/appointments/${appointment.id}` : "/api/appointments", {
        method: appointment ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: draft.kind,
          residentId: draft.residentId,
          careUnitId: draft.careUnitId,
          title: draft.title,
          category: draft.category,
          startsAt,
          endsAt,
          location: draft.location,
          notes: draft.notes,
          status: draft.status,
          outside,
          transport: outside ? draft.transport : null,
          transportNote: outside ? draft.transportNote : "",
          pickupAt,
          escort: outside ? draft.escort : "",
          documents: outside ? draft.documents : "",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Termin konnte nicht gespeichert werden.");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Termin konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!appointment) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Termin konnte nicht gelöscht werden.");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Termin konnte nicht gelöscht werden.");
      setSaving(false);
    }
  }

  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !saving) onClose();
      }}
    >
      <section
        className="area-editor-panel appointment-editor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-editor-title"
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">Kalender</p>
            <h2 id="appointment-editor-title">{appointment ? "Termin verwalten" : "Termin erstellen"}</h2>
            <p>
              {t.prefix}termine erscheinen auch in der {t.prefix}akte. Aufgaben für einen Wohnbereich bleiben im
              Betriebskalender.
            </p>
          </div>
          <button className="area-editor-close" type="button" aria-label="Terminfenster schliessen" onClick={onClose}>
            <X />
          </button>
        </header>
        <form className="area-editor-form" onSubmit={save}>
          <div className="area-editor-intro">
            <span className="area-editor-icon">{draft.kind === "resident" ? <CalendarDots /> : <ClipboardText />}</span>
            <div>
              <strong>
                {appointment
                  ? appointment.title
                  : draft.kind === "resident"
                    ? `Neuer ${t.prefix}termin`
                    : "Neue Wohnbereichsaufgabe"}
              </strong>
              <p>Alle Zeiten werden für das Alterszentrum in der Zeitzone Zürich geführt.</p>
            </div>
          </div>
          {!residentId && (
            <div className="appointment-kind-switch" role="group" aria-label="Terminart">
              <button
                type="button"
                className={draft.kind === "resident" ? "active" : ""}
                aria-pressed={draft.kind === "resident"}
                onClick={() => changeKind("resident")}
              >
                <CalendarDots /> {t.prefix}termin
              </button>
              <button
                type="button"
                className={draft.kind === "care_unit_task" ? "active" : ""}
                aria-pressed={draft.kind === "care_unit_task"}
                onClick={() => changeKind("care_unit_task")}
              >
                <ClipboardText /> Wohnbereichsaufgabe
              </button>
            </div>
          )}
          <div className="area-editor-grid appointment-editor-grid">
            <label className="area-editor-wide">
              <span>Bezeichnung</span>
              <input
                required
                maxLength={180}
                value={draft.title}
                onChange={(event) => update("title", event.target.value)}
                placeholder={
                  draft.kind === "resident"
                    ? "z. B. Arztvisite, Physiotherapie oder Untersuchung"
                    : "z. B. Materialbestand prüfen oder Übergabe vorbereiten"
                }
              />
            </label>
            {draft.kind === "resident" ? (
              <label>
                <span>{t.one}</span>
                {residentId ? (
                  <input value={selectedResident?.name ?? appointment?.resident_name ?? t.one} readOnly />
                ) : (
                  <CareSelect
                    label={t.one}
                    value={selectedResident?.label ?? `${t.oneOblique} auswählen`}
                    options={residentOptions.map((item) => item.label)}
                    onChange={(value) =>
                      update("residentId", residentOptions.find((item) => item.label === value)?.id ?? "")
                    }
                  />
                )}
              </label>
            ) : (
              <label>
                <span>Wohnbereich</span>
                <CareSelect
                  label="Wohnbereich"
                  value={selectedCareUnit?.name ?? "Wohnbereich auswählen"}
                  options={careUnits.map((item) => item.name)}
                  onChange={(value) => update("careUnitId", careUnits.find((item) => item.name === value)?.id ?? "")}
                />
              </label>
            )}
            <label>
              <span>Kategorie</span>
              <CareSelect
                label="Kategorie"
                value={draft.category}
                options={draft.kind === "resident" ? [...appointmentCategories] : [...careUnitTaskCategories]}
                onChange={(value) => update("category", value)}
              />
            </label>
            <label>
              <span>Datum</span>
              <CareDatePicker label="Termindatum" value={draft.date} onChange={(value) => update("date", value)} />
            </label>
            <label>
              <span>Ort</span>
              <input
                maxLength={180}
                value={draft.location}
                onChange={(event) => update("location", event.target.value)}
                placeholder={
                  draft.kind === "resident"
                    ? "z. B. Praxis, Therapieraum oder Spital"
                    : "z. B. Stationszimmer oder Lager"
                }
              />
            </label>
            <label>
              <span>Von</span>
              <CareSelect
                label="Beginn"
                value={draft.startTime}
                options={times}
                onChange={(value) => update("startTime", value)}
              />
            </label>
            <label>
              <span>Bis</span>
              <CareSelect
                label="Ende"
                value={draft.endTime}
                options={times}
                onChange={(value) => update("endTime", value)}
              />
            </label>
            {appointment && (
              <label>
                <span>Status</span>
                <CareSelect
                  label="Terminstatus"
                  value={statusLabels[draft.status]}
                  options={Object.values(statusLabels)}
                  onChange={(value) =>
                    update(
                      "status",
                      value === "Abgeschlossen" ? "completed" : value === "Abgesagt" ? "cancelled" : "scheduled",
                    )
                  }
                />
              </label>
            )}
            {draft.kind === "resident" && (
              <div className="area-editor-wide repositioning-choices" role="group" aria-label="Ausser Haus">
                <button
                  type="button"
                  className={`day-toggle ${draft.outside ? "active" : ""}`}
                  aria-pressed={draft.outside}
                  onClick={() => update("outside", !draft.outside)}
                >
                  Termin ausser Haus (Fahrdienst)
                </button>
              </div>
            )}
            {draft.kind === "resident" && draft.outside && (
              <>
                <label>
                  <span>Transport</span>
                  <CareSelect
                    label="Transport"
                    value={draft.transport ? TRANSPORT_LABELS[draft.transport] : NO_TRANSPORT}
                    options={[NO_TRANSPORT, ...Object.values(TRANSPORT_LABELS)]}
                    onChange={(value) =>
                      update(
                        "transport",
                        (Object.keys(TRANSPORT_LABELS) as AppointmentTransport[]).find(
                          (key) => TRANSPORT_LABELS[key] === value,
                        ) ?? null,
                      )
                    }
                  />
                </label>
                <label>
                  <span>Abholung im Haus</span>
                  <CareSelect
                    label="Abholung"
                    value={draft.pickupTime || NO_PICKUP}
                    options={[NO_PICKUP, ...times]}
                    onChange={(value) => update("pickupTime", value === NO_PICKUP ? "" : value)}
                  />
                </label>
                <label>
                  <span>Transport-Details</span>
                  <input
                    maxLength={300}
                    value={draft.transportNote}
                    onChange={(event) => update("transportNote", event.target.value)}
                    placeholder="z. B. Firma, Buchungsnummer, mit Rollstuhl"
                  />
                </label>
                <label>
                  <span>Begleitung</span>
                  <input
                    maxLength={200}
                    value={draft.escort}
                    onChange={(event) => update("escort", event.target.value)}
                    placeholder="z. B. Tochter, Mitarbeitende oder ohne Begleitung"
                  />
                </label>
                <label className="area-editor-wide">
                  <span>Mitzugebende Unterlagen</span>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={draft.documents}
                    onChange={(event) => update("documents", event.target.value)}
                    placeholder="z. B. Überleitungsbogen, Medikamentenplan, Versichertenkarte"
                  />
                </label>
              </>
            )}
            <label className="area-editor-wide">
              <span>Hinweise für das Team</span>
              <textarea
                rows={4}
                maxLength={4000}
                value={draft.notes}
                onChange={(event) => update("notes", event.target.value)}
                placeholder="Vorbereitung, Begleitung, Transport oder wichtige Informationen …"
              />
            </label>
          </div>
          {error && (
            <p className="appointment-editor-error" role="alert">
              {error}
            </p>
          )}
          {confirmDelete && (
            <div className="appointment-delete-confirm" role="alert">
              <strong>Termin endgültig löschen?</strong>
              <p>
                {draft.kind === "resident"
                  ? `Der Eintrag verschwindet auch aus der ${t.prefix}akte. `
                  : "Der Eintrag verschwindet aus dem Betriebskalender. "}
                Für eine Absage kannst du stattdessen den Status „Abgesagt“ wählen.
              </p>
              <div>
                <button className="secondary-button" type="button" onClick={() => setConfirmDelete(false)}>
                  Behalten
                </button>
                <button
                  className="appointment-danger-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void remove()}
                >
                  Ja, löschen
                </button>
              </div>
            </div>
          )}
          <footer className="area-editor-actions appointment-editor-actions">
            {appointment && !confirmDelete && (
              <button className="appointment-delete-button" type="button" onClick={() => setConfirmDelete(true)}>
                <Trash /> Löschen
              </button>
            )}
            <button className="secondary-button" type="button" onClick={onClose}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={saving || (draft.kind === "resident" ? !residents.length : !careUnits.length)}
            >
              <Check /> {saving ? "Speichern…" : appointment ? "Änderungen speichern" : "Termin erstellen"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
