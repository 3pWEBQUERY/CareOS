"use client";

import { useEffect, useState } from "react";
import { type AppointmentResident, type ResidentAppointment } from "@/lib/resident-appointments";
import type { ResidentRecordData } from "./resident-record-data";

export function useRecordAppointments({ resident }: { resident: ResidentRecordData }) {
  const [appointments, setAppointments] = useState<ResidentAppointment[]>([]);
  const [appointmentResidents, setAppointmentResidents] = useState<AppointmentResident[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(Boolean(resident.id));
  const [appointmentsError, setAppointmentsError] = useState("");
  const [appointmentEditor, setAppointmentEditor] = useState<ResidentAppointment | "new" | null>(null);
  const [appointmentRevision, setAppointmentRevision] = useState(0);
  const [clockNow, setClockNow] = useState(0);
  const upcomingAppointments = appointments.filter(
    (item) => item.status === "scheduled" && Date.parse(item.starts_at) >= clockNow,
  );
  const pastAppointments = appointments.filter(
    (item) => item.status !== "scheduled" || Date.parse(item.starts_at) < clockNow,
  );
  const nextAppointment = upcomingAppointments[0];
  const appointmentEditorResidents =
    resident.id && !appointmentResidents.some((item) => item.id === resident.id)
      ? [
          {
            id: resident.id,
            name: resident.name,
            status: "active",
            care_unit_id: null,
            care_unit_name: resident.unit,
            room_name: resident.room,
          },
          ...appointmentResidents,
        ]
      : appointmentResidents;

  useEffect(() => {
    const timer = window.setTimeout(() => setClockNow(Date.now()), 0);
    const interval = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!resident.id) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setAppointmentsLoading(true);
      fetch(`/api/appointments?residentId=${encodeURIComponent(resident.id!)}`, { cache: "no-store" })
        .then(async (response) => ({ response, data: await response.json().catch(() => null) }))
        .then(({ response, data }) => {
          if (!active) return;
          if (!response.ok) throw new Error(data?.error || "Termine konnten nicht geladen werden.");
          setAppointments(data.appointments ?? []);
          setAppointmentResidents(data.residents ?? []);
          setAppointmentsError("");
        })
        .catch((cause) => {
          if (active)
            setAppointmentsError(cause instanceof Error ? cause.message : "Termine konnten nicht geladen werden.");
        })
        .finally(() => {
          if (active) setAppointmentsLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [resident.id, appointmentRevision]);
  return {
    appointments,
    setAppointments,
    appointmentResidents,
    setAppointmentResidents,
    appointmentsLoading,
    setAppointmentsLoading,
    appointmentsError,
    setAppointmentsError,
    appointmentEditor,
    setAppointmentEditor,
    appointmentRevision,
    setAppointmentRevision,
    clockNow,
    setClockNow,
    upcomingAppointments,
    pastAppointments,
    nextAppointment,
    appointmentEditorResidents,
  };
}
