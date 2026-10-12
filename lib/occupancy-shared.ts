// Belegung und Eintritt: Plätze je Wohnbereich, Zimmer, geplante Eintritte und Warteliste (Server und Oberfläche).

export const WAITLIST_STATUS = {
  waiting: "Wartet",
  offered: "Platz angeboten",
  admitted: "Platz vergeben",
  withdrawn: "Zurückgezogen",
} as const;
export type WaitlistStatus = keyof typeof WAITLIST_STATUS;

export type OccupancyRoom = {
  id: string;
  name: string;
  beds: number;
  active: boolean;
  // Personen im Zimmer: aktiv bzw. verlegt (Platz bleibt reserviert) und geplante Eintritte.
  occupants: Array<{ id: string; name: string; status: "active" | "transferred" | "planned" }>;
};

export type OccupancyUnit = {
  id: string;
  name: string;
  // Plätze laut Wohnbereich (Kapazität), sonst die Betten der Zimmer.
  places: number;
  beds: number;
  occupied: number;
  reserved: number;
  free: number;
  rooms: OccupancyRoom[];
};

export type PlannedAdmission = {
  id: string;
  name: string;
  dateOfBirth: string | null;
  admittedOn: string | null;
  careUnitId: string | null;
  careUnit: string;
  room: string;
  waitlistId: string | null;
};

export type WaitlistEntry = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  desiredCareUnitId: string | null;
  desiredCareUnit: string | null;
  desiredFrom: string | null;
  registeredOn: string;
  note: string;
  status: WaitlistStatus;
  statusNote: string;
  residentId: string | null;
};

export type OccupancyOverview = {
  today: string;
  canWrite: boolean;
  canManageRooms: boolean;
  totals: { places: number; occupied: number; reserved: number; free: number };
  units: OccupancyUnit[];
  planned: PlannedAdmission[];
  waitlist: WaitlistEntry[];
  // Zurückgezogene und übernommene Einträge der letzten 180 Tage.
  closed: WaitlistEntry[];
};
