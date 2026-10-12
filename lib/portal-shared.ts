// Portal für Angehörige und Ärztinnen/Ärzte: Arten, Bereiche und Grundlagen der Freigabe (Server und Oberfläche).

export const PORTAL_KINDS = { relative: "Angehörige", physician: "Ärztin / Arzt", pharmacy: "Apotheke" } as const;
export type PortalKind = keyof typeof PORTAL_KINDS;

// Bereiche, die eine Freigabe einzeln öffnet. Die Grunddaten (Name, Geburtsdatum, Wohnbereich, Zimmer) gehören zu
// jeder Freigabe, damit die Person erkennbar ist.
export const PORTAL_AREAS = {
  emergency: "Notfalldaten (Reanimationsstatus, Allergien)",
  medication: "Medikation (laufende Verordnungen)",
  vitals: "Vitalwerte (30 Tage)",
  reports: "Pflegeberichte (14 Tage)",
  appointments: "Termine (kommende)",
  wounds: "Wunden (offene)",
  activities: "Alltag & Aktivitäten (Teilnahme 30 Tage, Angebote 14 Tage)",
  messages: "Nachrichten mit der Pflege",
  visit: "Visite (offene Fragen der Pflege beantworten, nur Ärztin / Arzt)",
} as const;
export type PortalArea = keyof typeof PORTAL_AREAS;
export const PORTAL_AREA_KEYS = Object.keys(PORTAL_AREAS) as PortalArea[];

// Bereiche, die nur ein Zugang der Art Ärztin / Arzt erhalten kann (bei anderen Zugängen wirkungslos).
const PHYSICIAN_AREAS: PortalArea[] = ["visit"];
export const portalAreaAllowed = (kind: PortalKind, area: PortalArea) =>
  kind === "physician" || !PHYSICIAN_AREAS.includes(area);

// Worauf die Freigabe beruht; der Vermerk hält Einzelheiten fest (z. B. Datum der Einwilligung).
export const PORTAL_BASES = {
  consent: "Einwilligung der Person",
  representative: "Vertretungsberechtigte Person",
  treatment: "Behandlungsverhältnis",
} as const;
export type PortalBasis = keyof typeof PORTAL_BASES;

export type PortalGrant = {
  id: string;
  residentId: string | null;
  residentName: string | null;
  careUnitId: string | null;
  careUnitName: string | null;
  areas: PortalArea[];
  validFrom: string | null;
  validUntil: string | null;
  basis: PortalBasis;
  basisNote: string;
  createdAt: string;
  createdBy: string | null;
  revokedAt: string | null;
};

export type PortalAccount = {
  id: string;
  kind: PortalKind;
  displayName: string;
  username: string;
  email: string;
  phone: string;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  grants: PortalGrant[];
};

export type PortalAccessEntry = {
  id: string;
  action: string;
  residentName: string | null;
  areas: PortalArea[];
  createdAt: string;
};

// Sicht des Portals: eine freigegebene Person mit den Bereichen (bei mehreren Freigaben zusammengeführt).
export type PortalResident = {
  id: string;
  name: string;
  birthDate: string | null;
  careUnit: string;
  room: string;
  areas: PortalArea[];
};

export type PortalResidentDetail = PortalResident & {
  emergency?: { resuscitation: string; resuscitationSource: string; decidedOn: string | null; allergies: string };
  medication?: Array<{ name: string; amount: string; times: string[]; prn: boolean; indication: string }>;
  vitals?: Array<{ metric: string; value: string; unit: string; measuredAt: string }>;
  reports?: Array<{ category: string; title: string; body: string; occurredAt: string }>;
  appointments?: Array<{ title: string; startsAt: string; location: string; category: string }>;
  wounds?: Array<{ title: string; location: string; status: string; since: string | null }>;
  // Teilgenommene Angebote der letzten 30 Tage und kommende Angebote (ohne Bemerkungen der Pflege).
  activities?: {
    attended: Array<{ title: string; category: string; startsAt: string }>;
    upcoming: Array<{ title: string; category: string; startsAt: string; location: string }>;
  };
  // Offene Fragen der Pflege für die Visite und Rückmeldungen der letzten 14 Tage.
  visit?: {
    open: Array<{ id: string; category: string; body: string; occurredAt: string; author: string }>;
    answered: Array<{ question: string; response: string; physician: string; resolvedAt: string }>;
  };
};

export const isPortalArea = (value: unknown): value is PortalArea => typeof value === "string" && value in PORTAL_AREAS;

// Freigegebene Bereiche aus JSON (unbekannte Einträge fallen weg).
export const portalAreas = (value: unknown): PortalArea[] =>
  Array.isArray(value) ? [...new Set(value.filter(isPortalArea))] : [];

// Mindestlänge und Zusammensetzung des Portal-Passworts.
export function portalPasswordProblem(password: string) {
  if (password.length < 12) return "Das Passwort braucht mindestens 12 Zeichen.";
  if (password.length > 200) return "Das Passwort ist zu lang.";
  if (!/[A-Za-zÄÖÜäöü]/.test(password) || !/\d/.test(password)) return "Das Passwort braucht Buchstaben und Ziffern.";
  return null;
}

// ---------- Nachrichten zwischen Portal und Pflege ----------

export type PortalMessage = {
  id: string;
  sender: "portal" | "staff";
  senderName: string;
  body: string;
  createdAt: string;
};

export type PortalThread = {
  id: string;
  subject: string;
  residentId: string | null;
  residentName: string | null;
  accountId: string;
  accountName: string;
  accountKind: PortalKind;
  lastMessageAt: string;
  lastMessage: string;
  unread: boolean;
  messages?: PortalMessage[];
};

// ---------- Apothekenportal: Bestellungen ----------

export const ORDER_STATUSES = {
  open: "Offen",
  confirmed: "Bestätigt",
  delivered: "Geliefert",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
} as const;
export type OrderStatus = keyof typeof ORDER_STATUSES;

export type PharmacyOrderItem = { medication: string; strength: string; quantity: number; unit: string; note: string };

export type PharmacyOrder = {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  careUnit: string | null;
  residentName: string | null;
  status: OrderStatus;
  note: string;
  pharmacyNote: string;
  expectedOn: string | null;
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
  items: PharmacyOrderItem[];
};
