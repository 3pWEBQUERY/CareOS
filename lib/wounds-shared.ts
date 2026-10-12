// Wound definitions shared by the API and the client workspace.

export const WOUND_TYPES = [
  "Dekubitus",
  "Ulcus cruris",
  "Diabetisches Fusssyndrom",
  "Skin Tear",
  "Operationswunde",
  "Traumatische Wunde",
  "Inkontinenzassoziierte Dermatitis",
  "Sonstige",
] as const;

// Pressure ulcer classification (EPUAP/NPIAP).
export const PRESSURE_CATEGORIES = [
  "Kategorie 1",
  "Kategorie 2",
  "Kategorie 3",
  "Kategorie 4",
  "Keiner Kategorie zuordenbar",
  "Vermutete tiefe Gewebeschädigung",
] as const;

export const ENTRY_TYPES = ["Erstbeurteilung", "Verbandwechsel", "Verlaufskontrolle", "Abschlussbeurteilung"] as const;
export const TISSUE_OPTIONS = ["Epithelisierung", "Granulation", "Fibrinbelag", "Nekrose", "Mischbild"] as const;
export const EXUDATE_OPTIONS = ["Kein", "Gering serös", "Mässig serös", "Stark serös", "Blutig", "Eitrig"] as const;
export const EDGE_OPTIONS = ["Intakt", "Gerötet", "Mazeriert", "Unterminiert", "Hyperkeratose"] as const;
export const SKIN_OPTIONS = ["Intakt", "Gerötet", "Mazeriert", "Trocken/schuppig", "Ödematös"] as const;

export const ORIGIN_LABELS = {
  inhouse: "Im Haus entstanden",
  external: "Mitgebracht",
  unknown: "Nicht bekannt",
} as const;
export type WoundOrigin = keyof typeof ORIGIN_LABELS;
export type WoundStatus = "active" | "healing" | "closed";
export const STATUS_LABELS: Record<WoundStatus, string> = {
  active: "In Behandlung",
  healing: "Heilend",
  closed: "Abgeschlossen",
};

// Verbandsmaterial einer Versorgung (Momentaufnahme aus dem Materialkatalog).
export type WoundMaterial = { productId: string; name: string; unit: string; quantity: number };
export const WOUND_MATERIALS_MAX = 20;

export type WoundEntry = {
  id: string;
  woundId: string;
  entryType: string;
  observedAt: string;
  author: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  depthCm: number | null;
  tissue: string | null;
  exudate: string | null;
  woundEdge: string | null;
  surroundingSkin: string | null;
  odor: boolean;
  infectionSigns: boolean;
  painScore: number | null;
  treatment: string | null;
  materials: WoundMaterial[];
  note: string | null;
};

export type Wound = {
  id: string;
  residentId: string;
  residentName: string;
  initials: string;
  room: string;
  careUnit: string;
  title: string;
  bodyLocation: string;
  woundType: string | null;
  category: string | null;
  diagnosis: string | null;
  origin: WoundOrigin;
  status: WoundStatus;
  discoveredAt: string | null;
  careIntervalDays: number | null;
  treatmentPlan: string | null;
  responsibleId: string | null;
  responsibleName: string | null;
  closedAt: string | null;
  closedReason: string | null;
  entryCount: number;
  photoCount: number;
  // Linked marker on the resident body map.
  bodyObservation: { id: string; label: string; location: string } | null;
  // Area (cm²) of the first and the most recent entry with length and width.
  firstArea: number | null;
  currentArea: number | null;
  latest: WoundEntry | null;
  nextCareAt: string | null;
  overdue: boolean;
  dueToday: boolean;
};

export type WoundInput = {
  residentId: string;
  title: string;
  bodyLocation: string;
  woundType: string;
  category: string | null;
  diagnosis: string;
  origin: WoundOrigin;
  discoveredOn: string;
  careIntervalDays: number | null;
  treatmentPlan: string;
  responsibleId: string | null;
  bodyObservationId: string | null;
};

export const area = (entry: Pick<WoundEntry, "lengthCm" | "widthCm"> | null) =>
  entry?.lengthCm && entry.widthCm ? entry.lengthCm * entry.widthCm : null;

// Share of the initial wound area that has healed (negative when the wound grew).
export function healingProgress(wound: Pick<Wound, "firstArea" | "currentArea">) {
  if (!wound.firstArea || wound.currentArea === null) return null;
  return Math.round(((wound.firstArea - wound.currentArea) / wound.firstArea) * 100);
}

export function formatCm(value: number | null) {
  return value === null ? "–" : value.toLocaleString("de-DE", { maximumFractionDigits: 1, useGrouping: false });
}

export function sizeLabel(entry: Pick<WoundEntry, "lengthCm" | "widthCm" | "depthCm"> | null) {
  if (!entry?.lengthCm || !entry.widthCm) return "Grösse nicht erfasst";
  return `${formatCm(entry.lengthCm)} × ${formatCm(entry.widthCm)}${entry.depthCm ? ` × ${formatCm(entry.depthCm)}` : ""} cm`;
}

export function woundTone(wound: Pick<Wound, "status" | "overdue" | "latest">) {
  if (wound.status === "closed") return "archived";
  if (wound.overdue || wound.latest?.infectionSigns) return "critical";
  return wound.status === "healing" ? "stable" : "attention";
}

export const materialLabel = (m: Pick<WoundMaterial, "name" | "unit" | "quantity">) =>
  `${m.quantity} ${m.unit} ${m.name}`;
