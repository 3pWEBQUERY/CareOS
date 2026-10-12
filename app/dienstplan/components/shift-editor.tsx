"use client";

import { useMemo, useState } from "react";
import { EditorDialog } from "@/app/components/workspace-ui";
import { localTime, plannedInterval } from "@/lib/roster/time";
import type { GridShift, SchedulePayload } from "@/lib/roster/view-types";
import { CareDatePicker, CareOptionSelect } from "@/app/components/care-form-controls";

export type ShiftDraft = {
  employeeId: string;
  date: string;
  shiftTypeId: string;
  customTimes: boolean;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  notes: string;
};

// Seitenpanel zum Anlegen und Bearbeiten eines Dienstes.
export function ShiftEditor({
  data,
  shift,
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  data: SchedulePayload;
  shift: GridShift | null;
  initial: { employeeId: string; date: string };
  onClose: () => void;
  onSave: (draft: ShiftDraft, times: { plannedStart?: string; plannedEnd?: string }) => Promise<void>;
  onDelete?: () => void;
}) {
  const types = data.shiftTypes.filter((type) => type.active || type.id === shift?.shiftTypeId);
  const firstType = types.find((type) => type.category !== "ABSENCE") ?? types[0];
  const type = (id: string) => types.find((t) => t.id === id);
  const [draft, setDraft] = useState<ShiftDraft>(() => {
    const current = shift ? type(shift.shiftTypeId ?? "") : firstType;
    const customTimes =
      !!shift &&
      !!current &&
      (localTime(shift.plannedStart, data.timezone) !== current.startTime ||
        localTime(shift.plannedEnd, data.timezone) !== current.endTime ||
        shift.breakMinutes !== current.breakMinutes);
    return {
      employeeId: shift?.employeeId ?? initial.employeeId,
      date: shift?.date ?? initial.date,
      shiftTypeId: shift?.shiftTypeId ?? firstType?.id ?? "",
      customTimes,
      startTime: shift ? localTime(shift.plannedStart, data.timezone) : (firstType?.startTime ?? "07:00"),
      endTime: shift ? localTime(shift.plannedEnd, data.timezone) : (firstType?.endTime ?? "15:30"),
      breakMinutes: shift?.breakMinutes ?? firstType?.breakMinutes ?? 0,
      notes: shift?.notes ?? "",
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = type(draft.shiftTypeId);
  const set = <K extends keyof ShiftDraft>(key: K, value: ShiftDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const selectType = (id: string) => {
    const next = type(id);
    setDraft((d) => ({
      ...d,
      shiftTypeId: id,
      startTime: d.customTimes ? d.startTime : (next?.startTime ?? d.startTime),
      endTime: d.customTimes ? d.endTime : (next?.endTime ?? d.endTime),
      breakMinutes: d.customTimes ? d.breakMinutes : (next?.breakMinutes ?? d.breakMinutes),
    }));
  };
  const duration = useMemo(() => {
    if (!draft.date || !draft.startTime || !draft.endTime || draft.startTime === draft.endTime) return null;
    const { start, end } = plannedInterval(draft.date, draft.startTime, draft.endTime, data.timezone);
    return Math.round((end.getTime() - start.getTime()) / 60_000) - draft.breakMinutes;
  }, [draft, data.timezone]);

  const submit = async () => {
    if (!draft.employeeId || !draft.date || !draft.shiftTypeId) {
      setError("Bitte Person, Datum und Diensttyp wählen.");
      return;
    }
    if (draft.customTimes && draft.startTime === draft.endTime) {
      setError("Beginn und Ende dürfen nicht gleich sein.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const times = draft.customTimes
        ? (() => {
            const { start, end } = plannedInterval(draft.date, draft.startTime, draft.endTime, data.timezone);
            return { plannedStart: start.toISOString(), plannedEnd: end.toISOString() };
          })()
        : {};
      await onSave(draft, times);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
      setSaving(false);
    }
  };

  return (
    <EditorDialog
      id="roster-shift"
      eyebrow={`Dienstplan · ${data.unit.name}`}
      title={shift ? "Dienst bearbeiten" : "Dienst hinzufügen"}
      description="Jede Änderung wird vor dem Speichern gegen Ruhezeit, Qualifikation, Abwesenheiten und Besetzung geprüft."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={shift ? "Änderung speichern" : "Dienst speichern"}
      extraActions={
        onDelete && (
          <button className="appointment-danger-button" type="button" onClick={onDelete} disabled={saving}>
            Dienst löschen
          </button>
        )
      }
    >
      <label>
        <span>Person</span>
        <CareOptionSelect
          label="Person"
          value={draft.employeeId}
          onChange={(value) => set("employeeId", value)}
          options={[
            ...data.employees.map((employee) => ({
              value: String(employee.id),
              label: `${employee.name} · ${employee.pensumPercent} %`,
            })),
            // Neue Dienste: auch Personen des Hauses, die dabei dem Wohnbereich zugeordnet werden.
            ...(shift ? [] : data.candidates).map((person) => ({
              value: person.id,
              label: `${person.name} · neu${person.detail ? ` (${person.detail})` : ""}`,
            })),
          ]}
        />
      </label>
      {!shift && data.candidates.some((person) => person.id === draft.employeeId) && (
        <p className="roster-muted area-editor-wide">
          Die Person wird beim Speichern {data.unit.name} zugeordnet und erscheint danach im Dienstplan.
        </p>
      )}
      <label>
        <span>Datum</span>
        <CareDatePicker label="Datum" value={draft.date} onChange={(value) => set("date", value)} />
      </label>
      <label className="area-editor-wide">
        <span>Diensttyp</span>
        <CareOptionSelect
          label="Diensttyp"
          value={draft.shiftTypeId}
          onChange={(value) => selectType(value)}
          options={[
            ...types.map((t) => ({
              value: String(t.id),
              label: `${t.code} · ${t.name} (${t.startTime}–${t.endTime})${t.active ? "" : " – inaktiv"}`,
            })),
          ]}
        />
      </label>
      <label className="area-editor-wide roster-checkbox">
        <input
          type="checkbox"
          checked={draft.customTimes}
          onChange={(event) => {
            const custom = event.target.checked;
            setDraft((d) => ({
              ...d,
              customTimes: custom,
              ...(custom || !selected
                ? {}
                : { startTime: selected.startTime, endTime: selected.endTime, breakMinutes: selected.breakMinutes }),
            }));
          }}
        />
        <span>Abweichende Zeiten für diesen Dienst</span>
      </label>
      {draft.customTimes && (
        <>
          <label>
            <span>Beginn</span>
            <input type="time" value={draft.startTime} onChange={(event) => set("startTime", event.target.value)} />
          </label>
          <label>
            <span>Ende {draft.endTime <= draft.startTime ? "(Folgetag)" : ""}</span>
            <input type="time" value={draft.endTime} onChange={(event) => set("endTime", event.target.value)} />
          </label>
          <label>
            <span>Pause (Minuten)</span>
            <input
              type="number"
              min={0}
              max={240}
              value={draft.breakMinutes}
              onChange={(event) => set("breakMinutes", Number(event.target.value))}
            />
          </label>
        </>
      )}
      <p className="area-editor-wide roster-muted">
        {selected ? `${selected.name}: ${draft.startTime}–${draft.endTime}` : ""}
        {duration !== null && selected?.category !== "ABSENCE"
          ? ` · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")} h netto`
          : ""}
      </p>
      <label className="area-editor-wide">
        <span>Notiz (optional, sichtbar im Dienstplan)</span>
        <textarea
          rows={2}
          maxLength={500}
          value={draft.notes}
          onChange={(event) => set("notes", event.target.value)}
          placeholder="z. B. Einarbeitung, Begleitung Arztbesuch"
        />
      </label>
    </EditorDialog>
  );
}

// „Verschieben nach…“ – barrierefreie Alternative zu Drag & Drop.
export function MoveDialog({
  data,
  shift,
  onClose,
  onMove,
}: {
  data: SchedulePayload;
  shift: GridShift;
  onClose: () => void;
  onMove: (employeeId: string, date: string) => Promise<void>;
}) {
  const [employeeId, setEmployeeId] = useState(shift.employeeId);
  const [date, setDate] = useState(shift.date);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <EditorDialog
      id="roster-move"
      eyebrow="Dienstplan"
      title="Dienst verschieben"
      description={`${shift.name} am ${shift.date.slice(8)}.${shift.date.slice(5, 7)}. an eine andere Person oder einen anderen Tag.`}
      onClose={onClose}
      onSubmit={async () => {
        setSaving(true);
        setError("");
        try {
          await onMove(employeeId, date);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Verschieben fehlgeschlagen.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel="Verschieben"
    >
      <label>
        <span>Person</span>
        <CareOptionSelect
          label="Person"
          value={employeeId}
          onChange={(value) => setEmployeeId(value)}
          options={[
            ...data.employees.map((employee) => ({ value: String(employee.id), label: String(employee.name) })),
          ]}
        />
      </label>
      <label>
        <span>Datum</span>
        <CareDatePicker label="Datum" value={date} onChange={(value) => setDate(value)} />
      </label>
    </EditorDialog>
  );
}
