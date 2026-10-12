"use client";

import { useEffect, useState } from "react";
import type { AuditEntry } from "@/lib/roster/audit-service";
import { formatDate, formatHours, formatSignedMinutes, localTime } from "@/lib/roster/time";
import { TIME_ENTRY_STATUS_LABELS } from "@/lib/roster/types";
import type { GridShift, SchedulePayload } from "@/lib/roster/view-types";
import { rosterRequest } from "./roster-api";
import { SidePanel } from "./side-panel";
import { ViolationList } from "./violation-dialog";

const ACTIONS: Record<string, string> = {
  created: "angelegt",
  updated: "geändert",
  moved: "verschoben",
  deleted: "gelöscht",
  swapped: "getauscht",
};

// Details eines Dienstes: Zeiten, Ist-Zeit und Differenz, Tausch, Warnungen und Verlauf.
export function ShiftDetail({
  data,
  shift,
  onClose,
  onEdit,
  onMove,
  onDelete,
}: {
  data: SchedulePayload;
  shift: GridShift;
  onClose: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [history, setHistory] = useState<AuditEntry[] | null>(null);
  const employee = data.employees.find((e) => e.id === shift.employeeId);
  const tz = data.timezone;
  useEffect(() => {
    if (!data.lead) return;
    let live = true;
    rosterRequest<AuditEntry[]>(`/api/dienstplan/audit?einheit=${data.unit.id}&dienst=${shift.id}`).then(
      (entries) => live && setHistory(entries),
      () => live && setHistory([]),
    );
    return () => {
      live = false;
    };
  }, [data.lead, data.unit.id, shift.id]);
  const editable = data.canEdit && !shift.masked;
  return (
    <SidePanel
      id="roster-shift-detail"
      eyebrow={`Dienstplan · ${data.unit.name}`}
      title={`${shift.name} · ${formatDate(shift.date, true)}`}
      description={employee?.name}
      onClose={onClose}
      actions={
        <>
          {editable && !shift.entry && (
            <button className="appointment-danger-button" type="button" onClick={onDelete}>
              Löschen
            </button>
          )}
          {editable && !shift.entry && (
            <button className="secondary-button" type="button" onClick={onMove}>
              Verschieben nach…
            </button>
          )}
          {editable && !shift.entry && (
            <button className="primary-button" type="button" onClick={onEdit}>
              Bearbeiten
            </button>
          )}
          {(!editable || shift.entry) && (
            <button className="secondary-button" type="button" onClick={onClose}>
              Schliessen
            </button>
          )}
        </>
      }
    >
      <dl className="roster-facts">
        <div>
          <dt>Diensttyp</dt>
          <dd>
            <span className="roster-type-dot" style={{ background: shift.color }} /> {shift.code} · {shift.name}
          </dd>
        </div>
        {!shift.masked && (
          <div>
            <dt>Geplant</dt>
            <dd>
              {localTime(shift.plannedStart, tz)}–{localTime(shift.plannedEnd, tz)}
              {shift.category !== "ABSENCE" &&
                ` · ${formatHours(shift.netMinutes)} netto · Pause ${shift.breakMinutes} Min`}
            </dd>
          </div>
        )}
        {shift.entry && (
          <div>
            <dt>Ist ({TIME_ENTRY_STATUS_LABELS[shift.entry.status]})</dt>
            <dd>
              {localTime(shift.entry.clockIn, tz)}–
              {shift.entry.clockOut ? localTime(shift.entry.clockOut, tz) : "läuft"}
              {shift.entry.differenceMinutes !== null &&
                ` · Differenz ${formatSignedMinutes(shift.entry.differenceMinutes)} (Beginn ${formatSignedMinutes(shift.entry.startDeviationMinutes)}, Ende ${formatSignedMinutes(shift.entry.endDeviationMinutes ?? 0)})`}
            </dd>
          </div>
        )}
        {shift.swapped && (
          <div>
            <dt>Getauscht</dt>
            <dd>
              ↔ {shift.swapped.with}
              {shift.swapped.at ? `, ${new Date(shift.swapped.at).toLocaleString("de-CH", { timeZone: tz })}` : ""}
            </dd>
          </div>
        )}
        {shift.source === "AI" && (
          <div>
            <dt>Herkunft</dt>
            <dd>Von der KI vorgeschlagen, von der Leitung übernommen</dd>
          </div>
        )}
        {shift.notes && (
          <div>
            <dt>Notiz</dt>
            <dd>{shift.notes}</dd>
          </div>
        )}
      </dl>
      {shift.entry && data.canEdit && (
        <p className="roster-muted">
          Für diesen Dienst ist Arbeitszeit erfasst; er kann nicht mehr verschoben oder gelöscht werden.
        </p>
      )}
      {shift.violations.length > 0 && (
        <section className="roster-panel-section">
          <h3>Regelprüfung</h3>
          <ViolationList violations={shift.violations} />
        </section>
      )}
      {data.lead && (
        <section className="roster-panel-section">
          <h3>Verlauf</h3>
          {history === null ? (
            <p className="roster-muted">Wird geladen …</p>
          ) : history.length ? (
            <ol className="roster-history">
              {history.map((entry) => (
                <li key={entry.id}>
                  <strong>{ACTIONS[entry.action] ?? entry.action}</strong> von {entry.actor}
                  <span>{new Date(entry.createdAt).toLocaleString("de-CH", { timeZone: tz })}</span>
                  {entry.reason && <em>Begründung: {entry.reason}</em>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="roster-muted">Keine Einträge (z. B. aus der Übernahme des bisherigen Dienstplans).</p>
          )}
        </section>
      )}
    </SidePanel>
  );
}
