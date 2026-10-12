"use client";

import { useMemo, useState } from "react";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import { EditorDialog } from "@/app/components/workspace-ui";
import { addDays, formatDate, isoWeek, weekStart } from "@/lib/roster/time";
import type { GridEmployee, SchedulePayload } from "@/lib/roster/view-types";
import type { CellValue } from "./roster-grid";

// Musterwoche übertragen (wie im PEP): Dienste einer Woche in die folgenden Wochen des Monats kopieren.
// Abwesenheiten und Dienste mit erfasster Arbeitszeit werden weder kopiert noch überschrieben.
export function CopyWeekDialog({
  data,
  employees,
  initialWeek,
  onClose,
  onApply,
}: {
  data: SchedulePayload;
  employees: GridEmployee[];
  initialWeek: string | null;
  onClose: () => void;
  onApply: (cells: CellValue[], label: string) => Promise<void>;
}) {
  const monthDays = useMemo(() => new Set(data.days.map((d) => d.date)), [data.days]);
  const weeks = useMemo(() => [...new Set(data.days.map((d) => weekStart(d.date)))].sort(), [data.days]);
  // Standard: angezeigte Woche, sonst die erste Woche, die mit einem Montag im Monat beginnt.
  const [source, setSource] = useState(
    initialWeek && weeks.includes(initialWeek) ? initialWeek : (weeks.find((w) => monthDays.has(w)) ?? weeks[0]),
  );
  const later = weeks.filter((w) => w > source);
  const [until, setUntil] = useState(later.at(-1) ?? "");
  const [clearFree, setClearFree] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const label = (week: string) => `KW ${isoWeek(week).week} · ${formatDate(week)}–${formatDate(addDays(week, 6))}`;

  const cells = useMemo(() => {
    const result: CellValue[] = [];
    const cell = (employeeId: string, date: string) =>
      data.shifts.filter((s) => s.employeeId === employeeId && s.date === date);
    for (const target of weeks.filter((w) => w > source && w <= until))
      for (const employee of employees)
        for (let offset = 0; offset < 7; offset += 1) {
          const from = addDays(source, offset);
          const to = addDays(target, offset);
          if (!monthDays.has(from) || !monthDays.has(to)) continue;
          const existing = cell(employee.id, to);
          if (existing.some((s) => s.category === "ABSENCE" || s.entry || s.masked)) continue;
          const pattern = cell(employee.id, from).find((s) => s.category !== "ABSENCE" && !s.masked);
          if (pattern) {
            if (existing.length !== 1 || existing[0].shiftTypeId !== pattern.shiftTypeId)
              result.push({ employeeId: employee.id, date: to, shiftTypeId: pattern.shiftTypeId });
          } else if (clearFree && existing.length)
            result.push({ employeeId: employee.id, date: to, shiftTypeId: null });
        }
    return result;
  }, [data.shifts, employees, weeks, source, until, clearFree, monthDays]);

  const submit = async () => {
    if (!until) {
      setError("Im Monat gibt es keine weitere Woche.");
      return;
    }
    if (!cells.length) {
      setError("Es gibt nichts zu übertragen – die Zielwochen entsprechen bereits der Musterwoche.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onApply(cells, `Woche übertragen · ${cells.length} Zellen`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Übertragen fehlgeschlagen.");
      setSaving(false);
    }
  };

  return (
    <EditorDialog
      id="roster-copy-week"
      eyebrow={`Dienstplan · ${data.unit.name}`}
      title="Woche übertragen"
      description="Die Dienste der Musterwoche werden in die folgenden Wochen kopiert. Abwesenheiten und Dienste mit erfasster Arbeitszeit bleiben unverändert; jede Zelle läuft durch die Regelprüfung."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={error}
      submitLabel={cells.length ? `${cells.length} Zellen übertragen` : "Übertragen"}
    >
      <label>
        <span>Musterwoche</span>
        <CareOptionSelect
          label="Musterwoche"
          value={source}
          onChange={(value) => {
            setSource(value);
            const next = weeks.filter((w) => w > value);
            if (!next.includes(until)) setUntil(next.at(-1) ?? "");
          }}
          options={weeks.slice(0, -1).map((week) => ({ value: week, label: label(week) }))}
        />
      </label>
      <label>
        <span>Übertragen bis</span>
        <CareOptionSelect
          label="Übertragen bis"
          value={until}
          onChange={setUntil}
          options={later.map((week) => ({ value: week, label: label(week) }))}
        />
      </label>
      <label className="roster-checkbox area-editor-wide">
        <input type="checkbox" checked={clearFree} onChange={(event) => setClearFree(event.target.checked)} />
        Freie Tage der Musterwoche auch in den Zielwochen leeren
      </label>
      <p className="roster-muted area-editor-wide">
        {employees.length} Personen · {cells.length} Zellen werden gesetzt oder geleert.
      </p>
    </EditorDialog>
  );
}
