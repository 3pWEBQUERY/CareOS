// Zeit- und Datumslogik des Dienstplans (Spec Abschnitt 3). Reine Funktionen ohne Zugriff auf
// die aktuelle Zeit: Dauer immer aus absoluten Zeitpunkten, lokale Tage in der Zeitzone des
// Regelwerks, Nachtdienste gehören zum Starttag.
import type { BreakRule } from "./types";

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTE = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function localParts(instant: number, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// Offset of the zone at an instant, in minutes (Zürich: +60 in winter, +120 in summer).
export function offsetMinutes(instant: number, timeZone: string) {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE);
}

// Absolute instant of a local date and time. Non-existent times (spring gap) move forward.
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMinutes(guess, timeZone) * MINUTE;
  const second = guess - offsetMinutes(first, timeZone) * MINUTE;
  return new Date(second);
}

export function localDate(instant: Date | string | number, timeZone: string) {
  const p = localParts(new Date(instant).getTime(), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function localTime(instant: Date | string | number, timeZone: string) {
  const p = localParts(new Date(instant).getTime(), timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);

// ISO weekday: 1 = Montag … 7 = Sonntag.
export function weekday(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export const isWeekend = (date: string) => weekday(date) >= 6;
export const weekStart = (date: string) => addDays(date, 1 - weekday(date));

export function isoWeek(date: string) {
  const thursday = addDays(date, 4 - weekday(date));
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return { year, week };
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
export const monthStart = (year: number, month: number) => `${monthKey(year, month)}-01`;
export const monthEnd = (year: number, month: number) => `${monthKey(year, month)}-${daysInMonth(year, month)}`;

export function monthDays(year: number, month: number) {
  return Array.from({ length: daysInMonth(year, month) }, (_, index) => addDays(monthStart(year, month), index));
}

export function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const minutesBetween = (start: Date | string, end: Date | string) =>
  Math.round((new Date(end).getTime() - new Date(start).getTime()) / MINUTE);

// Planned interval of a shift type on a local day; an end at or before the start is on the next day.
export function plannedInterval(date: string, startTime: string, endTime: string, timeZone: string) {
  const start = zonedToUtc(date, startTime, timeZone);
  const end = zonedToUtc(endTime <= startTime ? addDays(date, 1) : date, endTime, timeZone);
  return { start, end };
}

export const netMinutes = (start: Date | string, end: Date | string, breakMinutes: number) =>
  Math.max(minutesBetween(start, end) - breakMinutes, 0);

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// Minutes of an interval inside a daily local window, e.g. 23:00–06:00 (crossing midnight).
export function windowMinutes(start: Date | string, end: Date | string, from: string, to: string, timeZone: string) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (e <= s) return 0;
  let total = 0;
  const first = addDays(localDate(s, timeZone), -1);
  const last = localDate(e, timeZone);
  for (let day = first; day <= last; day = addDays(day, 1)) {
    const windowStart = zonedToUtc(day, from, timeZone).getTime();
    const windowEnd = zonedToUtc(to <= from ? addDays(day, 1) : day, to, timeZone).getTime();
    total += overlap(s, e, windowStart, windowEnd);
  }
  return Math.round(total / MINUTE);
}

// Minutes of an interval that fall on the given local days (whole days 00:00–24:00).
export function dayMinutes(
  start: Date | string,
  end: Date | string,
  days: (date: string) => boolean,
  timeZone: string,
) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (e <= s) return 0;
  let total = 0;
  for (let day = localDate(s, timeZone); day <= localDate(e, timeZone); day = addDays(day, 1)) {
    if (!days(day)) continue;
    total += overlap(
      s,
      e,
      zonedToUtc(day, "00:00", timeZone).getTime(),
      zonedToUtc(addDays(day, 1), "00:00", timeZone).getTime(),
    );
  }
  return Math.round(total / MINUTE);
}

export const weekendMinutes = (start: Date | string, end: Date | string, timeZone: string) =>
  dayMinutes(start, end, isWeekend, timeZone);

export const holidayMinutes = (start: Date | string, end: Date | string, holidays: string[], timeZone: string) => {
  const set = new Set(holidays);
  return dayMinutes(start, end, (day) => set.has(day), timeZone);
};

// Break the law requires for a working time ("mehr als …"); 0 when no rule applies.
export function requiredBreak(workMinutes: number, rules: BreakRule[]) {
  return rules.reduce(
    (required, rule) => (workMinutes > rule.minWorkMinutes ? Math.max(required, rule.minBreakMinutes) : required),
    0,
  );
}

export type Deviation = {
  plannedMinutes: number;
  actualMinutes: number;
  differenceMinutes: number;
  startDeviationMinutes: number;
  endDeviationMinutes: number;
};

// Netto-Ist minus Netto-Soll, plus Abweichung von Beginn und Ende (Spec 2.2 Nr. 1).
export function deviation(
  planned: { start: Date | string; end: Date | string; breakMinutes: number },
  actual: { clockIn: Date | string; clockOut: Date | string; breakMinutes: number },
): Deviation {
  const plannedMinutes = netMinutes(planned.start, planned.end, planned.breakMinutes);
  const actualMinutes = netMinutes(actual.clockIn, actual.clockOut, actual.breakMinutes);
  return {
    plannedMinutes,
    actualMinutes,
    differenceMinutes: actualMinutes - plannedMinutes,
    startDeviationMinutes: minutesBetween(planned.start, actual.clockIn),
    endDeviationMinutes: minutesBetween(planned.end, actual.clockOut),
  };
}

// "8:30 h", "−0:45 h"
export function formatHours(minutes: number, signed = false) {
  const sign = minutes < 0 ? "−" : signed && minutes > 0 ? "+" : "";
  const value = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")} h`;
}

export const formatSignedMinutes = (minutes: number) =>
  `${minutes < 0 ? "−" : minutes > 0 ? "+" : "±"}${Math.abs(Math.round(minutes))} Min`;

export function formatDate(date: string, withYear = false) {
  const [year, month, day] = date.split("-");
  return withYear ? `${day}.${month}.${year}` : `${day}.${month}.`;
}

export const MONTH_NAMES = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];
export const monthLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1]} ${year}`;
