"use client";

import { useTerms } from "@/app/components/care-context";
import { CaretLeft, CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { CareSelect } from "@/app/components/care-form-controls";
import { appointmentLocalParts, appointmentTargetLabel } from "@/lib/resident-appointments";
import { weekDayNames, dateFromKey, dateKey, monthStart, monthDays, dateHeading } from "./calendar-grid";
import type { ResidentCalendarState } from "./use-resident-calendar";

export function CalendarSidebar({ r }: { r: ResidentCalendarState }) {
  const t = useTerms();
  const {
    today,
    focusDate,
    setFocusDate,
    unit,
    setUnit,
    status,
    setStatus,
    query,
    setQuery,
    setEditor,
    units,
    selectedDay,
    monthTitle,
  } = r;
  return (
    <aside className="card resident-calendar-sidebar">
      <div className="resident-calendar-mini-head">
        <strong>{monthTitle}</strong>
        <div>
          <button
            type="button"
            aria-label="Vorheriger Monat"
            onClick={() =>
              setFocusDate((current) => {
                const date = dateFromKey(monthStart(current));
                date.setUTCMonth(date.getUTCMonth() - 1);
                return dateKey(date);
              })
            }
          >
            <CaretLeft />
          </button>
          <button
            type="button"
            aria-label="Nächster Monat"
            onClick={() =>
              setFocusDate((current) => {
                const date = dateFromKey(monthStart(current));
                date.setUTCMonth(date.getUTCMonth() + 1);
                return dateKey(date);
              })
            }
          >
            <CaretRight />
          </button>
        </div>
      </div>
      <div className="resident-calendar-mini-grid">
        {weekDayNames.map((name) => (
          <span key={name}>{name}</span>
        ))}
        {monthDays(focusDate).map((date) => (
          <button
            key={date}
            type="button"
            className={`${date === focusDate ? "selected" : ""} ${date.slice(0, 7) !== focusDate.slice(0, 7) ? "outside" : ""} ${date === today ? "today" : ""}`}
            onClick={() => setFocusDate(date)}
            aria-label={dateHeading(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          >
            {Number(date.slice(-2))}
          </button>
        ))}
      </div>
      <div className="resident-calendar-sidebar-section">
        <p className="eyebrow">Ansicht filtern</p>
        <label>
          <span>Wohnbereich</span>
          <CareSelect label="Wohnbereich" value={unit} options={units} onChange={setUnit} />
        </label>
        <label>
          <span>Status</span>
          <CareSelect
            label="Terminstatus"
            value={status}
            options={["Alle Termine", "Geplant", "Abgeschlossen", "Abgesagt"]}
            onChange={setStatus}
          />
        </label>
        <label className="resident-calendar-search">
          <MagnifyingGlass />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Termin, Aufgabe oder ${t.one} suchen`}
            aria-label="Termine suchen"
          />
        </label>
      </div>
      <div className="resident-calendar-sidebar-section resident-calendar-agenda">
        <p className="eyebrow">{dateHeading(focusDate, { weekday: "long", day: "numeric", month: "long" })}</p>
        <strong>{selectedDay.length ? `${selectedDay.length} Einträge` : "Keine Einträge"}</strong>
        {selectedDay.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`resident-calendar-agenda-item ${item.status} ${item.kind === "care_unit_task" ? "care-unit-task" : ""}`}
            onClick={() => setEditor({ appointment: item })}
          >
            <span>{appointmentLocalParts(item.starts_at).time}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{appointmentTargetLabel(item)}</small>
            </div>
          </button>
        ))}
        {!selectedDay.length && (
          <p className="resident-calendar-agenda-empty">Wähle einen anderen Tag oder plane einen neuen Termin.</p>
        )}
      </div>
    </aside>
  );
}
