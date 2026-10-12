import type { AdvanceAnswer, Representative } from "./advance-care-shared";
import type { EvacuationMobility } from "./evacuation-shared";
import type { KompassStatusSummary } from "./kompass-shared";
// Resident record (Bewohnerakte): master data, key figures, timeline and documents,
// shared by the API and the record panel.

export const MARITAL_STATUSES = ["Ledig", "Verheiratet", "Eingetragene Partnerschaft", "Verwitwet", "Geschieden"];
// Konfession bzw. Religionszugehörigkeit zur Auswahl in den Stammdaten, je Land der Einrichtung (Bezeichnungen der
// Landeskirchen bzw. anerkannten Kirchen und Religionsgesellschaften).
const SHARED_RELIGIONS = [
  "Evangelisch-freikirchlich",
  "Orthodox",
  "Andere christliche Gemeinschaft",
  "Jüdisch",
  "Muslimisch",
  "Buddhistisch",
  "Hinduistisch",
  "Andere Religion",
  "Konfessionslos",
  "Keine Angabe gewünscht",
];
export const RELIGIONS: Record<"CH" | "DE" | "AT", string[]> = {
  CH: ["Römisch-katholisch", "Evangelisch-reformiert", "Christkatholisch", ...SHARED_RELIGIONS],
  DE: ["Römisch-katholisch", "Evangelisch", "Altkatholisch", ...SHARED_RELIGIONS],
  AT: ["Römisch-katholisch", "Evangelisch A.B.", "Evangelisch H.B.", "Altkatholisch", ...SHARED_RELIGIONS],
};
// Beziehung einer Kontaktperson zur betreuten Person (Auswahl; ein früher frei erfasster Wert bleibt erhalten).
export const CONTACT_RELATIONSHIPS = [
  "Ehefrau",
  "Ehemann",
  "Lebenspartnerin",
  "Lebenspartner",
  "Tochter",
  "Sohn",
  "Schwiegertochter",
  "Schwiegersohn",
  "Enkelin",
  "Enkel",
  "Schwester",
  "Bruder",
  "Mutter",
  "Vater",
  "Nichte",
  "Neffe",
  "Weitere Angehörige",
  "Freundin",
  "Freund",
  "Nachbarin",
  "Nachbar",
  "Beistand / gesetzliche Vertretung",
  "Hausärztin / Hausarzt",
  "Andere Bezugsperson",
];
export const LANGUAGES: Record<string, string> = {
  "de-CH": "Deutsch",
  "fr-CH": "Französisch",
  "it-CH": "Italienisch",
  en: "Englisch",
  other: "Andere",
};
// Dokumente der Bewohnerakte: PDFs und Bilder (z. B. fotografierte Arztberichte), höchstens 4 MB.
export const RESIDENT_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const RESIDENT_FILE_MAX_BYTES = 4 * 1024 * 1024;

// Reanimationsstatus: Entscheid gemäss Patientenverfügung bzw. ärztlicher Verordnung. Ohne Eintrag „nicht erfasst“.
export const RESUSCITATION_STATUSES = {
  full: { label: "Reanimation erwünscht", short: "REA: Ja" },
  dnr: { label: "Keine Reanimation (DNR)", short: "REA: Nein" },
} as const;
export type ResuscitationStatus = keyof typeof RESUSCITATION_STATUSES;
export const resuscitationShort = (status: ResuscitationStatus | null) =>
  status ? RESUSCITATION_STATUSES[status].short : "REA: nicht erfasst";

export const RESIDENT_DOCUMENT_CATEGORIES = ["Arztberichte", "Pflege", "Medikation", "Administration"] as const;

export type MasterData = {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: string;
  maritalStatus: string | null;
  language: string;
  socialSecurityNumber: string | null;
  religion: string | null;
  externalNumber: string | null;
  admittedOn: string | null;
  admissionReason: string | null;
  primaryNurseId: string | null;
  gpName: string | null;
  gpPractice: string | null;
  gpPhone: string | null;
  pharmacy: string | null;
  insurer: string | null;
  insuranceNumber: string | null;
  resuscitationStatus: ResuscitationStatus | null;
  // Grundlage des Entscheids, z. B. „Patientenverfügung“ oder „Ärztliche Verordnung Dr. …“.
  resuscitationSource: string | null;
  resuscitationDecidedOn: string | null;
  // Vorsorge: liegt eine Patientenverfügung bzw. ein Vorsorgeauftrag (DE/AT: Vorsorgevollmacht) vor?
  advanceDirective: AdvanceAnswer | null;
  advanceDirectiveOn: string | null;
  // Wo das Original liegt, z. B. „Kopie im Dokumentenordner, Original bei der Tochter“.
  advanceDirectiveLocation: string | null;
  careMandate: AdvanceAnswer | null;
  careMandateOn: string | null;
  careMandateEffectiveOn: string | null;
  // Brandfall und Evakuation: wie die Person das Haus verlässt, und Hinweise wie Sauerstoff oder Hörgerät.
  evacuationMobility: EvacuationMobility | null;
  evacuationNote: string | null;
};

export type RecordSummary = {
  master: MasterData;
  primaryNurse: string | null;
  planOwner: string | null;
  careLevel: string | null;
  checkedAt: string | null;
  checkedBy: string | null;
  missing: string[];
  lastVital: { measuredAt: string; metric: string; status: string } | null;
  medsToday: { given: number; total: number };
  documentsCount: number;
  staff: Array<{ id: string; name: string }>;
  canWrite: boolean;
  // Änderungsprotokoll: nur für die Leitung (Rollen mit team.manage oder administration.manage).
  canViewAudit: boolean;
  // Auskunft und Datenexport (Administration).
  canExport: boolean;
  // Vertretungsberechtigte Person aus den Kontaktpersonen (nach Vorrang der Rolle), für den Aktenkopf.
  representative: Representative | null;
  // Stand der Bedarfsabklärung mit dem CareOS Kompass (für den Pflegeprozess).
  kompass: KompassStatusSummary;
};

export type TimelineCategory = "Pflege" | "Vitalwerte" | "Medikation" | "Termine";

export type TimelineEntry = {
  id: string;
  category: TimelineCategory;
  occurredAt: string;
  title: string;
  description: string;
  author: string | null;
  tone: "critical" | "attention" | "info" | "stable";
  documentationId: string | null;
};

export type ResidentFile = {
  id: string;
  title: string;
  category: string;
  description: string | null;
  fileId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  uploadedBy: string | null;
};
