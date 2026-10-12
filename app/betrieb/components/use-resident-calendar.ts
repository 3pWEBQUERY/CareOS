"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  appointmentLocalParts,
  appointmentTargetLabel,
  initialAppointmentDraft,
  zurichTimeToIso,
  type AppointmentCareUnit,
  type AppointmentResident,
  type ResidentAppointment,
} from "@/lib/resident-appointments";
import {
  View,
  EditorState,
  dateFromKey,
  dateKey,
  addDays,
  weekStart,
  monthStart,
  monthDays,
  dateHeading,
  statusName,
} from "./calendar-grid";

export function useResidentCalendar() {
  const today = appointmentLocalParts(new Date()).date;
  const [focusDate, setFocusDate] = useState(today);
  const [view, setView] = useState<View>("day");
  const [appointments, setAppointments] = useState<ResidentAppointment[]>([]);
  const [residents, setResidents] = useState<AppointmentResident[]>([]);
  const [careUnits, setCareUnits] = useState<AppointmentCareUnit[]>([]);
  const [unit, setUnit] = useState("Alle Wohnbereiche");
  const [status, setStatus] = useState("Alle Termine");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const weekScrollRef = useRef<HTMLDivElement>(null);

  const days = useMemo(
    () =>
      view === "day"
        ? [focusDate]
        : view === "week"
          ? Array.from({ length: 7 }, (_, index) => addDays(weekStart(focusDate), index))
          : monthDays(focusDate),
    [focusDate, view],
  );
  const range = useMemo(
    () => ({ from: zurichTimeToIso(days[0], "00:00"), to: zurichTimeToIso(addDays(days.at(-1)!, 1), "00:00") }),
    [days],
  );
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/appointments?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`, {
        cache: "no-store",
      })
        .then(async (response) => ({ response, data: await response.json().catch(() => null) }))
        .then(({ response, data }) => {
          if (!active) return;
          if (!response.ok) throw new Error(data?.error || "Kalender konnte nicht geladen werden.");
          setAppointments(data.appointments ?? []);
          setResidents(data.residents ?? []);
          setCareUnits(data.careUnits ?? []);
          setError("");
        })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : "Kalender konnte nicht geladen werden.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [range.from, range.to, revision]);
  useEffect(() => {
    if (view !== "month") weekScrollRef.current?.scrollTo({ top: 7 * 48, behavior: "instant" });
  }, [view, range.from]);

  const units = useMemo(() => ["Alle Wohnbereiche", ...careUnits.map((item) => item.name)], [careUnits]);
  const visible = useMemo(
    () =>
      appointments.filter((item) => {
        const matchesUnit = unit === "Alle Wohnbereiche" || item.care_unit_name === unit;
        const matchesStatus = status === "Alle Termine" || statusName(item.status) === status;
        const haystack =
          `${item.title} ${appointmentTargetLabel(item)} ${item.category} ${item.location ?? ""}`.toLocaleLowerCase(
            "de-CH",
          );
        return matchesUnit && matchesStatus && haystack.includes(query.trim().toLocaleLowerCase("de-CH"));
      }),
    [appointments, unit, status, query],
  );
  const selectedDay = visible.filter((item) => {
    const start = Date.parse(zurichTimeToIso(focusDate, "00:00"));
    const end = Date.parse(zurichTimeToIso(addDays(focusDate, 1), "00:00"));
    return Date.parse(item.starts_at) < end && Date.parse(item.ends_at) > start;
  });
  const scheduledCount = appointments.filter((item) => item.status === "scheduled").length;
  const monthTitle = dateHeading(focusDate, { month: "long", year: "numeric" });
  const toolbarTitle =
    view === "month"
      ? monthTitle
      : view === "day"
        ? dateHeading(focusDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : `${dateHeading(days[0], { day: "numeric", month: "short" })} – ${dateHeading(days[6], { day: "numeric", month: "short", year: "numeric" })}`;

  function move(direction: number) {
    if (view === "day") setFocusDate((current) => addDays(current, direction));
    else if (view === "week") setFocusDate((current) => addDays(current, direction * 7));
    else
      setFocusDate((current) => {
        const next = dateFromKey(monthStart(current));
        next.setUTCMonth(next.getUTCMonth() + direction);
        return dateKey(next);
      });
  }
  function create(date = focusDate, time = "09:00") {
    setEditor({
      draft: {
        ...initialAppointmentDraft("", date, time),
        careUnitId: careUnits.find((item) => item.name === unit)?.id ?? "",
      },
    });
  }
  function saved() {
    setEditor(null);
    setRevision((current) => current + 1);
  }
  return {
    today,
    focusDate,
    setFocusDate,
    view,
    setView,
    appointments,
    setAppointments,
    residents,
    setResidents,
    careUnits,
    setCareUnits,
    unit,
    setUnit,
    status,
    setStatus,
    query,
    setQuery,
    editor,
    setEditor,
    loading,
    setLoading,
    error,
    setError,
    revision,
    setRevision,
    weekScrollRef,
    days,
    range,
    units,
    visible,
    selectedDay,
    scheduledCount,
    monthTitle,
    toolbarTitle,
    move,
    create,
    saved,
  };
}

export type ResidentCalendarState = ReturnType<typeof useResidentCalendar>;
