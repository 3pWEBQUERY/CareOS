// Types and constants shared by the medication API routes and the client workspace.

export type RoundKey = "morning" | "noon" | "evening" | "night";

// Local times (organization time zone). The night round of a day also covers the
// early morning hours of the following day.
export const ROUNDS: Record<
  RoundKey,
  { label: string; segments: Array<{ dayOffset: number; from: string; to: string }> }
> = {
  morning: { label: "Morgenrunde · 05–11 Uhr", segments: [{ dayOffset: 0, from: "05:00", to: "10:59" }] },
  noon: { label: "Mittagsrunde · 11–15 Uhr", segments: [{ dayOffset: 0, from: "11:00", to: "14:59" }] },
  evening: { label: "Abendrunde · 15–21 Uhr", segments: [{ dayOffset: 0, from: "15:00", to: "20:59" }] },
  night: {
    label: "Nachtrunde · 21–05 Uhr",
    segments: [
      { dayOffset: 0, from: "21:00", to: "23:59" },
      { dayOffset: 1, from: "00:00", to: "04:59" },
    ],
  },
};

export function roundForTime(time: string): RoundKey {
  if (time >= "05:00" && time < "11:00") return "morning";
  if (time >= "11:00" && time < "15:00") return "noon";
  if (time >= "15:00" && time < "21:00") return "evening";
  return "night";
}

export const ADMINISTRATION_STATUSES = ["administered", "declined", "omitted", "delayed"] as const;
export type AdministrationStatus = (typeof ADMINISTRATION_STATUSES)[number];

export const administrationLabels: Record<AdministrationStatus | "scheduled", string> = {
  scheduled: "Offen",
  administered: "Gegeben",
  declined: "Verweigert",
  omitted: "Ausgelassen",
  delayed: "Verschoben",
};

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

export type MedResident = {
  id: string;
  name: string;
  initials: string;
  room: string;
  careUnit: string;
  allergies: string | null;
  regularCount: number;
  prnCount: number;
};

export type MedOrder = {
  id: string;
  residentId: string;
  medicationId: string | null;
  name: string;
  strength: string;
  form: string;
  // Betäubungsmittel (BtM-Kennzeichnung des Präparats).
  controlled: boolean;
  route: string;
  amount: string;
  // Units deducted from stock per dose (e.g. 1 for „1 Tablette“); null = no stock booking.
  stockQuantity: number | null;
  times: string[];
  weekdays: number[];
  isPrn: boolean;
  maxDosesPer24h: number | null;
  minIntervalHours: number | null;
  // Wirkungskontrolle nach einer Reservegabe (Minuten), von der Verordnung festgelegt; null = keine geplante Kontrolle.
  effectCheckMinutes: number | null;
  prnInstructions: string;
  indication: string;
  prescribedBy: string;
  startOn: string | null;
  endOn: string | null;
  status: "active" | "paused";
  updatedAt: string;
  // Reserve (PRN) orders only
  lastAdministeredAt: string | null;
  administeredLast24h: number;
  residentStock: number | null;
  wardStock: number | null;
  stockUnit: string | null;
};

export type OrderInput = {
  name: string;
  strength: string;
  form: string;
  route: string;
  amount: string;
  // Units deducted from stock per dose (e.g. 1 for „1 Tablette“); null = no stock booking.
  stockQuantity: number | null;
  times: string[];
  weekdays: number[];
  isPrn: boolean;
  maxDosesPer24h: number | null;
  minIntervalHours: number | null;
  effectCheckMinutes: number | null;
  prnInstructions: string;
  indication: string;
  prescribedBy: string;
  startOn: string;
  endOn: string | null;
};

export type RoundDose = {
  orderId: string;
  residentId: string;
  residentName: string;
  initials: string;
  room: string;
  careUnit: string;
  allergies: string | null;
  medication: string;
  controlled: boolean;
  amount: string;
  route: string;
  scheduledAt: string;
  time: string;
  status: AdministrationStatus | "scheduled";
  administeredAt: string | null;
  administeredBy: string | null;
  note: string | null;
  orderChangedRecently: boolean;
};

export type StockItem = {
  id: string;
  medicationId: string;
  name: string;
  strength: string;
  form: string;
  owner: string;
  ownerKind: "unit" | "resident";
  location: string;
  quantity: number;
  unit: string;
  minimum: number | null;
  expiresOn: string | null;
  batch: string;
  updatedAt: string;
  // Betäubungsmittel: Buchungen nur mit Zweitunterschrift (BtM-Kontrolle).
  controlled: boolean;
};

export type StockMovement = {
  id: string;
  createdAt: string;
  medication: string;
  residentName: string | null;
  delta: number;
  reason: "receipt" | "administration" | "correction" | "disposal";
  note: string | null;
  userName: string | null;
};

export const movementLabels: Record<StockMovement["reason"], string> = {
  receipt: "Eingang",
  administration: "Gabe",
  correction: "Korrektur",
  disposal: "Entsorgung",
};

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

// Wirkungskontrolle nach Reservegabe.
export const EFFECT_RESULTS = {
  effective: "Wirksam",
  partial: "Teilweise wirksam",
  none: "Nicht wirksam",
} as const;
export type EffectResult = keyof typeof EFFECT_RESULTS;

export type EffectCheck = {
  administrationId: string;
  residentId: string;
  residentName: string;
  room: string;
  medication: string;
  reason: string;
  administeredAt: string;
  administeredBy: string | null;
  dueAt: string;
  overdue: boolean;
};
