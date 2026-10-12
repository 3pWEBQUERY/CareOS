"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ModuleIcon } from "@/app/components/module-icon";
import { requestJson } from "@/app/components/workspace-ui";
import {
  CHECKLIST,
  HANDOVER_STATUS,
  SHIFT_TYPES,
  type ChecklistKey,
  type HandoverStatus,
  type ShiftOverview,
  type ShiftType,
} from "@/lib/shift-shared";
import { ScheduleDatePicker, ScheduleSelect, formatScheduleDate, notifyOperationsChanged } from "./operations-ui";
import { clock, zurichDay, ALL_UNITS, PLANNED, suggestedShift } from "./shift-utils";

export function ShiftStartEditor({
  overview,
  onClose,
  onStarted,
}: {
  overview: ShiftOverview;
  onClose: () => void;
  onStarted: (message: string) => void;
}) {
  const planned = overview.current && !overview.current.checkedInAt ? overview.current : null;
  const suggestion = suggestedShift();
  const [shift, setShift] = useState<string>(planned ? PLANNED : suggestion.type);
  const usePlanned = Boolean(planned && shift === PLANNED);
  const [unitId, setUnitId] = useState(overview.careUnit.id ?? "");
  const [startDate, setStartDate] = useState(suggestion.date);
  const [handover, setHandover] = useState<HandoverStatus>(overview.unreadHandover ? "pending" : "complete");
  const [checklist, setChecklist] = useState<ChecklistKey[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const unitName = usePlanned
    ? (planned?.careUnit ?? ALL_UNITS)
    : (overview.careUnits.find((unit) => unit.id === unitId)?.name ?? ALL_UNITS);
  const times =
    usePlanned && planned
      ? `${clock(planned.startsAt)}–${clock(planned.endsAt)}`
      : SHIFT_TYPES[shift as ShiftType]
        ? `${SHIFT_TYPES[shift as ShiftType].start}–${SHIFT_TYPES[shift as ShiftType].end}`
        : "";
  const toggleChecklist = (item: ChecklistKey) =>
    setChecklist((current) =>
      current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item],
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await requestJson("/api/shift/check-in", {
        method: "POST",
        body: {
          ...(usePlanned && planned
            ? { assignmentId: planned.assignmentId }
            : { shiftType: shift, date: startDate, careUnitId: unitId || null }),
          checklist,
          handoverStatus: handover,
          note,
        },
      });
      notifyOperationsChanged();
      onStarted(`${usePlanned && planned ? planned.name : shift} im ${unitName} wurde gestartet`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  }

  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && !saving && onClose()}
    >
      <section
        className="area-editor-panel shift-start-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-start-title"
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">Mein Dienst</p>
            <h2 id="shift-start-title">Dienst starten</h2>
            <p>
              Starte deinen Dienst mit einem kurzen Check-in und halte fest, dass die wichtigsten Übergabepunkte geprüft
              sind.
            </p>
          </div>
          <button className="area-editor-close" type="button" onClick={onClose} aria-label="Dienststart schliessen">
            ×
          </button>
        </header>
        <form className="area-editor-form" onSubmit={submit}>
          <div className="area-editor-intro">
            <span className="area-editor-icon">
              <ModuleIcon name="shift" />
            </span>
            <div>
              <strong>Schicht-Check-in</strong>
              <p>Dein Start wird mit Uhrzeit und Arbeitsbereich im Schichtverlauf gespeichert.</p>
            </div>
            <span className="duty-assignment-status">
              <i />
              {planned ? "Dienst geplant" : "Bereit zum Start"}
            </span>
          </div>
          <div className="area-editor-grid">
            <label>
              Arbeitsbereich
              {usePlanned ? (
                <input value={unitName} readOnly aria-readonly="true" />
              ) : (
                <ScheduleSelect
                  label="Arbeitsbereich"
                  value={unitName}
                  options={[...overview.careUnits.map((unit) => unit.name), ALL_UNITS]}
                  onChange={(name) => setUnitId(overview.careUnits.find((unit) => unit.name === name)?.id ?? "")}
                />
              )}
            </label>
            <label>
              Dienst
              <ScheduleSelect
                label="Dienst"
                value={usePlanned && planned ? `${PLANNED}: ${planned.name}` : shift}
                options={[...(planned ? [`${PLANNED}: ${planned.name}`] : []), ...Object.keys(SHIFT_TYPES)]}
                onChange={(value) => setShift(value.startsWith(PLANNED) ? PLANNED : value)}
              />
            </label>
            <label>
              Startdatum
              {usePlanned && planned ? (
                <input value={formatScheduleDate(zurichDay(planned.startsAt))} readOnly aria-readonly="true" />
              ) : (
                <ScheduleDatePicker label="Startdatum" value={startDate} onChange={setStartDate} />
              )}
            </label>
            <label>
              Übergabestatus
              <ScheduleSelect
                label="Übergabestatus"
                value={HANDOVER_STATUS[handover]}
                options={Object.values(HANDOVER_STATUS)}
                onChange={(label) =>
                  setHandover(
                    (Object.keys(HANDOVER_STATUS) as HandoverStatus[]).find((key) => HANDOVER_STATUS[key] === label) ??
                      "pending",
                  )
                }
              />
            </label>
            {overview.unreadHandover > 0 && (
              <p className="area-editor-wide shift-start-hint">
                <ModuleIcon name="handover" />
                {overview.unreadHandover} ungelesene{overview.unreadHandover === 1 ? "r" : ""} Übergabepunkt
                {overview.unreadHandover === 1 ? "" : "e"} – <Link href="/betrieb/uebergabe">jetzt lesen</Link>
              </p>
            )}
            <fieldset className="area-editor-wide duty-assignment-options">
              <legend>Start-Checkliste</legend>
              <div className="area-service-options">
                {(Object.keys(CHECKLIST) as ChecklistKey[]).map((item) => (
                  <label className={checklist.includes(item) ? "selected" : ""} key={item}>
                    <input type="checkbox" checked={checklist.includes(item)} onChange={() => toggleChecklist(item)} />
                    <span>{CHECKLIST[item]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="area-editor-wide">
              Notiz zum Dienststart
              <textarea
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="z. B. besondere Prioritäten für diesen Dienst …"
                rows={4}
              />
            </label>
          </div>
          <div className="duty-assignment-summary">
            <span>
              <strong>{usePlanned && planned ? planned.name : shift}</strong>
              <small>
                {unitName} · {times}
              </small>
            </span>
            <span>
              <strong>{formatScheduleDate(usePlanned && planned ? zurichDay(planned.startsAt) : startDate)}</strong>
              <small>
                {checklist.length}/{Object.keys(CHECKLIST).length} Punkte geprüft · {HANDOVER_STATUS[handover]}
              </small>
            </span>
          </div>
          {error && (
            <p className="appointment-editor-error" role="alert">
              {error}
            </p>
          )}
          <footer className="area-editor-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>
              Abbrechen
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              <ModuleIcon name="check" /> {saving ? "Wird gestartet…" : "Dienst starten"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
