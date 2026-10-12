import type { AppointmentStatus, AppointmentTransport } from "@/lib/resident-appointments";

// Tagesliste Fahrdienst (Empfang): Termine ausser Haus eines Tages mit Transport, Abholung, Begleitung, Unterlagen
// sowie Abfahrt und Rückkehr.

export const OUTING_EVENTS = { departed: "Abgefahren", returned: "Zurück", undo: "Rückgängig" } as const;
export type OutingEvent = keyof typeof OUTING_EVENTS;

export type Outing = {
  id: string;
  residentId: string;
  residentName: string;
  room: string;
  careUnit: string;
  title: string;
  category: string;
  location: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  transport: AppointmentTransport | null;
  transportNote: string;
  pickupAt: string | null;
  escort: string;
  documents: string;
  notes: string;
  departed: { at: string; by: string | null } | null;
  returned: { at: string; by: string | null } | null;
};

export type OutingDay = { date: string; today: string; organization: string; canWrite: boolean; outings: Outing[] };
