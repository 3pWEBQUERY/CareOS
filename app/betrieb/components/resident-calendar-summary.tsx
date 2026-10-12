"use client";

import { CalendarDots, Clock, UsersThree } from "@phosphor-icons/react";
import type { ResidentCalendarState } from "./use-resident-calendar";

export function CalendarSummary({ r }: { r: ResidentCalendarState }) {
  const { appointments, scheduledCount } = r;
  return (
    <section className="resident-calendar-summary" aria-label="Kalenderübersicht">
      <span>
        <CalendarDots />
        <strong>{appointments.length}</strong>
        <small>Einträge im Zeitraum</small>
      </span>
      <span>
        <Clock />
        <strong>{scheduledCount}</strong>
        <small>geplant</small>
      </span>
      <span>
        <UsersThree />
        <strong>{appointments.filter((item) => item.kind === "care_unit_task").length}</strong>
        <small>Wohnbereichsaufgaben</small>
      </span>
    </section>
  );
}
