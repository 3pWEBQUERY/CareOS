"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, X } from "@phosphor-icons/react";
import { formatHours, localTime, monthLabel } from "@/lib/roster/time";
import { WEEKDAY_SHORT } from "@/lib/roster/types";
import type { GridShift, SchedulePayload } from "@/lib/roster/view-types";
import { useRosterData } from "./roster-api";

const zurichMonth = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()).slice(0, 7);

// Druckansicht des Monatsplans (A4 quer). Über den Druckdialog des Browsers als PDF speicherbar.
// team: veröffentlichter Teamplan (Spec 8.5) wie in „Mein Dienst › Teamplan“.
export default function RosterPrint({ team }: { team?: boolean }) {
  const params = useSearchParams();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("monat") ?? "") ? params.get("monat")! : zurichMonth();
  const unit = params.get("einheit");
  const query = new URLSearchParams({
    monat: month,
    ...(unit ? { einheit: unit } : {}),
    ...(team ? { ansicht: "team" } : {}),
  });
  const { data, error } = useRosterData<SchedulePayload>(`/api/dienstplan/schedule?${query}`);
  const published = data?.period?.status === "PUBLISHED";
  const printable = !!data && (!team || published);

  const byCell = useMemo(() => {
    const map = new Map<string, GridShift[]>();
    for (const shift of data?.shifts ?? []) {
      const key = `${shift.employeeId}|${shift.date}`;
      map.set(key, [...(map.get(key) ?? []), shift]);
    }
    return map;
  }, [data]);
  const staffingTypes = useMemo(
    () => (data ? data.shiftTypes.filter((type) => data.staffing.some((cell) => cell.shiftTypeId === type.id)) : []),
    [data],
  );
  const usedTypes = useMemo(() => {
    const used = new Set((data?.shifts ?? []).map((shift) => shift.shiftTypeId));
    return (data?.shiftTypes ?? []).filter((type) => used.has(type.id));
  }, [data]);

  // Druckdialog einmal automatisch öffnen, sobald der Plan geladen ist.
  const printed = useRef(false);
  useEffect(() => {
    if (!printable || printed.current || params.get("dialog") === "0") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, [printable, params]);

  const [year, monthNumber] = month.split("-").map(Number);
  const title = `${team ? "Teamplan" : "Dienstplan"} ${data?.unit.name ?? ""} · ${monthLabel(year, monthNumber)}`;

  return (
    <main className="roster-print">
      {/* Nur auf dieser Seite: A4 quer. */}
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <div className="roster-print-bar">
        <strong>Druckansicht</strong>
        <span>A4 quer · im Druckdialog „Als PDF speichern“ wählen</span>
        <button className="primary-button" type="button" disabled={!printable} onClick={() => window.print()}>
          <Printer className="button-icon" /> Drucken / PDF
        </button>
        <button className="secondary-button" type="button" onClick={() => window.close()}>
          <X className="button-icon" /> Schliessen
        </button>
      </div>
      {!(data && printable) && <h1 className="print-hidden-heading">{title}</h1>}
      {error && !data ? (
        <p className="roster-print-message" role="alert">
          Der Plan konnte nicht geladen werden: {error.message}
        </p>
      ) : !data ? (
        <p className="roster-print-message">Plan wird geladen …</p>
      ) : !printable ? (
        <p className="roster-print-message">Für {monthLabel(year, monthNumber)} ist noch kein Plan veröffentlicht.</p>
      ) : (
        <article className="roster-print-sheet">
          <header>
            <div>
              <h1>{title}</h1>
              <p>
                {published
                  ? `Veröffentlicht${data.period?.publishedAt ? ` am ${new Date(data.period.publishedAt).toLocaleDateString("de-CH", { timeZone: data.timezone })}` : ""}`
                  : "Entwurf – nicht veröffentlicht"}
                {" · "}Stand{" "}
                {new Date().toLocaleString("de-CH", {
                  timeZone: data.timezone,
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            </div>
            {!published && <span className="roster-print-draft">Entwurf</span>}
          </header>
          <table>
            <thead>
              <tr>
                <th scope="col" className="name">
                  Mitarbeitende
                </th>
                {data.days.map((day) => (
                  <th
                    key={day.date}
                    scope="col"
                    className={`${day.weekend ? "weekend" : ""} ${day.holiday ? "holiday" : ""}`}
                    title={day.holiday ?? undefined}
                  >
                    <span>{WEEKDAY_SHORT[day.weekday - 1]}</span>
                    <strong>
                      {Number(day.date.slice(8))}
                      {day.holiday ? "*" : ""}
                    </strong>
                  </th>
                ))}
                {data.lead && (
                  <th scope="col" className="total">
                    <span>Plan</span>
                    <strong>Soll</strong>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((employee) => (
                <tr key={employee.id}>
                  <th scope="row" className="name">
                    {employee.name}
                    <small>{employee.pensumPercent} %</small>
                  </th>
                  {data.days.map((day) => {
                    const shifts = byCell.get(`${employee.id}|${day.date}`) ?? [];
                    return (
                      <td key={day.date} className={`${day.weekend ? "weekend" : ""} ${day.holiday ? "holiday" : ""}`}>
                        {shifts.map((shift) => (
                          <span
                            key={shift.id}
                            className="code"
                            style={
                              shift.masked ? undefined : { borderColor: shift.color, background: `${shift.color}26` }
                            }
                          >
                            {shift.masked ? "Abw." : shift.code}
                          </span>
                        ))}
                      </td>
                    );
                  })}
                  {data.lead && (
                    <td className="total">
                      {employee.plannedMinutes !== null ? formatHours(employee.plannedMinutes).replace(" h", "") : "–"}
                      <small>
                        {employee.targetMinutes !== null ? formatHours(employee.targetMinutes).replace(" h", "") : "–"}
                      </small>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {staffingTypes.length > 0 && (
              <tfoot>
                {staffingTypes.map((type) => (
                  <tr key={type.id}>
                    <th scope="row" className="name">
                      {type.code} · Besetzung
                    </th>
                    {data.days.map((day) => {
                      const cell = data.staffing.find((s) => s.date === day.date && s.shiftTypeId === type.id);
                      const low = cell && cell.min !== null && cell.count < cell.min;
                      return (
                        <td key={day.date} className={low ? "low" : ""}>
                          {cell ? `${cell.count}${cell.min !== null ? `/${cell.min}` : ""}` : ""}
                        </td>
                      );
                    })}
                    {data.lead && <td className="total" />}
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
          <footer>
            {usedTypes.map((type) => (
              <span key={type.id}>
                <i style={{ borderColor: type.color, background: `${type.color}26` }}>{type.code}</i> {type.name}
                {type.category !== "ABSENCE" && ` ${type.startTime}–${type.endTime}`}
              </span>
            ))}
            {data.shifts.some((shift) => shift.masked) && (
              <span>
                <i>Abw.</i> Abwesend
              </span>
            )}
            {data.days.some((day) => day.holiday) && <span>* Feiertag</span>}
          </footer>
          {data.shifts.some((shift) => !shift.masked && shift.notes) && (
            <section className="roster-print-notes">
              <h2>Bemerkungen</h2>
              <ul>
                {data.shifts
                  .filter((shift) => !shift.masked && shift.notes)
                  .map((shift) => (
                    <li key={shift.id}>
                      {shift.date.slice(8)}.{shift.date.slice(5, 7)}.{" "}
                      {data.employees.find((e) => e.id === shift.employeeId)?.name ?? ""} · {shift.code}{" "}
                      {localTime(shift.plannedStart, data.timezone)}–{localTime(shift.plannedEnd, data.timezone)}:{" "}
                      {shift.notes}
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </article>
      )}
    </main>
  );
}
