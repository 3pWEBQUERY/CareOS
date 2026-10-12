"use client";

import { type RefObject } from "react";
import {
  appointmentLocalParts,
  appointmentTargetLabel,
  zurichTimeToIso,
  type AppointmentDraft,
  type ResidentAppointment,
} from "@/lib/resident-appointments";

export type View = "day" | "week" | "month";

export type EditorState = { appointment?: ResidentAppointment; draft?: AppointmentDraft } | null;

export const weekDayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export const dateFromKey = (key: string) => new Date(`${key}T12:00:00Z`);

export const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export const addDays = (key: string, days: number) => {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
};

export const weekStart = (key: string) => addDays(key, -((dateFromKey(key).getUTCDay() + 6) % 7));

export const monthStart = (key: string) => `${key.slice(0, 7)}-01`;

export const calendarStart = (key: string) => weekStart(monthStart(key));

export const hourLines = Array.from({ length: 24 }, (_, hour) => hour);

export const monthDays = (key: string) => Array.from({ length: 42 }, (_, index) => addDays(calendarStart(key), index));

export const dateHeading = (key: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "UTC", ...options }).format(dateFromKey(key));

export const statusName = (status: ResidentAppointment["status"]) =>
  status === "completed" ? "Abgeschlossen" : status === "cancelled" ? "Abgesagt" : "Geplant";

export const eventTime = (appointment: ResidentAppointment) =>
  `${appointmentLocalParts(appointment.starts_at).time}–${appointmentLocalParts(appointment.ends_at).time}`;

export function weekSegments(items: ResidentAppointment[], date: string) {
  const start = Date.parse(zurichTimeToIso(date, "00:00"));
  const end = Date.parse(zurichTimeToIso(addDays(date, 1), "00:00"));
  const segments = items
    .filter((item) => Date.parse(item.starts_at) < end && Date.parse(item.ends_at) > start)
    .map((item) => {
      const clippedStart = Math.max(start, Date.parse(item.starts_at));
      const clippedEnd = Math.min(end, Date.parse(item.ends_at));
      const startParts = appointmentLocalParts(clippedStart);
      const endParts = appointmentLocalParts(clippedEnd);
      const minutes =
        startParts.date === date ? Number(startParts.time.slice(0, 2)) * 60 + Number(startParts.time.slice(3)) : 0;
      const endMinutes =
        endParts.date === date ? Number(endParts.time.slice(0, 2)) * 60 + Number(endParts.time.slice(3)) : 1440;
      return { item, minutes, endMinutes: Math.max(minutes + 15, endMinutes), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.minutes - b.minutes || b.endMinutes - a.endMinutes);
  let group: typeof segments = [];
  let groupEnd = -1;
  const finishGroup = () => {
    if (group.length) {
      const lanes: number[] = [];
      for (const item of group) {
        let lane = lanes.findIndex((endAt) => endAt <= item.minutes);
        if (lane < 0) {
          lane = lanes.length;
          lanes.push(item.endMinutes);
        } else lanes[lane] = item.endMinutes;
        item.lane = lane;
      }
      for (const item of group) item.lanes = lanes.length;
    }
    group = [];
  };
  for (const segment of segments) {
    if (segment.minutes >= groupEnd) finishGroup();
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.endMinutes);
  }
  finishGroup();
  return segments;
}

export function TimedCalendarGrid({
  days,
  today,
  view,
  appointments,
  scrollRef,
  onCreate,
  onSelectDate,
  onOpen,
}: {
  days: string[];
  today: string;
  view: "day" | "week";
  appointments: ResidentAppointment[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onCreate: (date: string, time: string) => void;
  onSelectDate: (date: string) => void;
  onOpen: (appointment: ResidentAppointment) => void;
}) {
  return (
    <div className="resident-calendar-week-scroll" ref={scrollRef}>
      <div className={`resident-calendar-week-grid ${view === "day" ? "resident-calendar-day-grid" : ""}`}>
        <div className="resident-calendar-time-header">Zürich</div>
        {days.map((date) => (
          <div className={`resident-calendar-week-head ${date === today ? "today" : ""}`} key={date}>
            <span>{dateHeading(date, { weekday: view === "day" ? "long" : "short" })}</span>
            <button
              type="button"
              onClick={() => onSelectDate(date)}
              aria-label={`${dateHeading(date, { day: "numeric", month: "long", year: "numeric" })} auswählen`}
            >
              {view === "day"
                ? dateHeading(date, { day: "numeric", month: "long", year: "numeric" })
                : Number(date.slice(-2))}
            </button>
          </div>
        ))}
        <div className="resident-calendar-time-rail">
          {hourLines.map((hour) => (
            <span key={hour} style={{ top: hour * 48 }}>
              {String(hour).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        {days.map((date) => (
          <div className={`resident-calendar-day-column ${date === today ? "today" : ""}`} key={date}>
            <div className="resident-calendar-hour-slots">
              {hourLines.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  aria-label={`Termin am ${dateHeading(date, { day: "numeric", month: "long" })} um ${String(hour).padStart(2, "0")}:00 erstellen`}
                  onClick={() => onCreate(date, `${String(hour).padStart(2, "0")}:00`)}
                />
              ))}
            </div>
            {weekSegments(appointments, date).map(({ item, minutes, endMinutes, lane, lanes }) => {
              const durationMinutes = endMinutes - minutes;
              return (
                <button
                  type="button"
                  className={`resident-calendar-week-event ${view === "day" ? "resident-calendar-day-event" : ""} ${item.kind === "care_unit_task" ? "care-unit-task" : ""} ${item.category === "Arzttermin" ? "medical" : ""} ${item.status}`}
                  key={item.id}
                  style={{
                    top: (minutes / 60) * 48 + 2,
                    height: Math.max(25, (durationMinutes / 60) * 48 - 3),
                    left: `calc(${(lane * 100) / lanes}% + 3px)`,
                    width: `calc(${100 / lanes}% - 6px)`,
                  }}
                  aria-label={`${item.title}, ${appointmentTargetLabel(item)}, ${eventTime(item)}`}
                  onClick={() => onOpen(item)}
                >
                  <strong>
                    {item.title}
                    {view === "day" ? ` · ${appointmentTargetLabel(item)}` : ""}
                  </strong>
                  {durationMinutes >= 60 && <span>{eventTime(item)}</span>}
                  {durationMinutes >= 105 && (
                    <small>{view === "day" ? item.location || item.category : appointmentTargetLabel(item)}</small>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
