// Alltagsgestaltung und Aktivierung: Angebote, Teilnahme je Person und Monatsübersicht (Server und Oberfläche).

export const ACTIVITY_CATEGORIES = [
  "Bewegung",
  "Gedächtnis",
  "Musik & Singen",
  "Kreativ & Handwerk",
  "Kochen & Backen",
  "Gesellschaft & Gespräch",
  "Spiritualität",
  "Ausflug",
  "Einzelbetreuung",
  "Andere",
] as const;

export const PARTICIPATION_STATUS = {
  participated: "Teilgenommen",
  declined: "Abgelehnt",
  absent: "Nicht anwesend",
} as const;
export type ParticipationStatus = keyof typeof PARTICIPATION_STATUS;
export const PARTICIPATION_KEYS = Object.keys(PARTICIPATION_STATUS) as ParticipationStatus[];

export const MAX_REPEAT_WEEKS = 12;

export type Activity = {
  id: string;
  seriesId: string | null;
  careUnitId: string | null;
  careUnit: string | null;
  title: string;
  category: string;
  description: string;
  location: string;
  leader: string;
  startsAt: string;
  durationMinutes: number;
  // Begonnen (ab 15 Minuten vor Beginn): Teilnahme erfassbar, Absagen nicht mehr.
  started: boolean;
  cancelledAt: string | null;
  cancelReason: string;
  counts: Record<ParticipationStatus, number>;
};

export type ActivityWeek = {
  from: string;
  to: string;
  careUnitId: string | null;
  canWrite: boolean;
  activities: Activity[];
  // Für die Leitung von Angeboten zugeteilte Mitarbeitende (Auswahl im Dialog).
  leaders: string[];
};

export type ActivityParticipant = {
  residentId: string;
  name: string;
  room: string;
  careUnit: string;
  status: ParticipationStatus | null;
  note: string;
};

export type ActivityDetail = {
  activity: Activity;
  participants: ActivityParticipant[];
};

export type ActivityReportResident = {
  id: string;
  name: string;
  room: string;
  careUnit: string;
  counts: Record<ParticipationStatus, number>;
  // Teilgenommene Angebote je Kategorie.
  byCategory: Record<string, number>;
  lastParticipation: string | null;
};

export type ActivityReport = {
  month: string;
  careUnitId: string | null;
  offered: number;
  cancelled: number;
  categories: string[];
  residents: ActivityReportResident[];
};

export const emptyCounts = (): Record<ParticipationStatus, number> => ({ participated: 0, declined: 0, absent: 0 });
