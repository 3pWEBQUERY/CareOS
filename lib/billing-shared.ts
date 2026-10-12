// Abrechnung (Server und Oberfläche): Taxen der Einrichtung, Pflegestufe, Abwesenheiten und die Berechnung eines
// Monats je Person. Beträge in Rappen bzw. Cent. Tarife und Regeln legt die Einrichtung fest.

export const RATE_CATEGORIES = {
  pension: "Pension",
  support: "Betreuung",
  care: "Pflege",
  extra: "Weitere Leistungen",
} as const;
export type RateCategory = keyof typeof RATE_CATEGORIES;

export const PAYERS = {
  resident: "Person selbst",
  insurer: "Krankenversicherung",
  public: "Öffentliche Hand",
  other: "Andere",
} as const;
export type Payer = keyof typeof PAYERS;

export const ABSENCE_KINDS = { hospital: "Spital", vacation: "Ferien", other: "Andere Abwesenheit" } as const;
export type AbsenceKind = keyof typeof ABSENCE_KINDS;

// Abwesenheit: die ersten `fullDays` Tage voll verrechnet, danach `percent` Prozent. null: Abwesenheit ändert nichts.
export type AbsenceRule = { fullDays: number; percent: number } | null;

export type RatePrice = { validFrom: string; amountCents: number };

export type BillingRate = {
  id: string;
  name: string;
  category: RateCategory;
  payer: Payer;
  careLevel: string | null;
  applies: "all" | "assigned";
  hospital: AbsenceRule;
  // Ferien und andere Abwesenheiten.
  absence: AbsenceRule;
  prices: RatePrice[];
  archived: boolean;
};

export type CareLevelEntry = {
  id: string;
  level: string;
  validFrom: string;
  note: string;
  author: string;
  createdAt: string;
};

export type Absence = {
  id: string;
  kind: AbsenceKind;
  startsOn: string;
  endsOn: string | null;
  note: string;
  author: string;
};

export type AssignedRate = { id: string; rateId: string; name: string; validFrom: string; validUntil: string | null };

// Aufenthalt im Haus (Eintritt bis Austritt; offen, solange die Person wohnt).
export type StayPeriod = { from: string; until: string | null };

export type BillingLine = {
  rateId: string;
  name: string;
  category: RateCategory;
  payer: Payer;
  // Preis je Tag; bei Preisänderungen im Monat mehrere Zeilen.
  priceCents: number;
  fullDays: number;
  // Tage mit reduziertem Satz wegen Abwesenheit, mit Prozentsatz.
  reduced: Array<{ days: number; percent: number; kind: "hospital" | "absence" }>;
  amountCents: number;
};

export type BillingMonth = {
  month: string;
  // Tage im Haus bzw. verrechnete Tage (laut Aufenthalt und Regel zum Austrittstag) und davon abwesend.
  billedDays: number;
  absentDays: { hospital: number; absence: number };
  lines: BillingLine[];
  totals: Array<{ payer: Payer; amountCents: number }>;
  totalCents: number;
  // Hinweise, warum etwas fehlt (z. B. keine Pflegestufe, kein Tarif für die Stufe).
  warnings: string[];
};

export type BillingSettings = { dischargeDayBilled: boolean | null };

export type BillingPerson = {
  residentId: string;
  resident: { name: string; room: string; unit: string; admittedOn: string | null };
  currency: string;
  today: string;
  careLevels: CareLevelEntry[];
  // Pflegestufe laut Pflegeplan (zum Vergleich).
  planCareLevel: string | null;
  absences: Absence[];
  assigned: AssignedRate[];
  preview: BillingMonth | null;
  previewMonth: string;
  // Rechnungsadresse für den Anteil der Person.
  address: PostalAddress | null;
  settings: BillingSettings;
};

export type BillingCatalog = {
  currency: string;
  today: string;
  levels: Array<{ value: string; detail: string }>;
  levelLabel: string;
  rates: BillingRate[];
  settings: BillingSettings;
};

export const ruleText = (rule: AbsenceRule) =>
  !rule
    ? "voll verrechnet"
    : rule.fullDays === 0
      ? `${rule.percent} % ab dem ersten Tag`
      : `${rule.fullDays} ${rule.fullDays === 1 ? "Tag" : "Tage"} voll, danach ${rule.percent} %`;

// ---------------------------------------------------------------- Rechnungen

export type PostalAddress = {
  name: string;
  // Nur auf der Rechnung (z. B. „c/o Beistandschaft“), nicht im QR-Code.
  addition?: string;
  street: string;
  building: string;
  zip: string;
  city: string;
  country: string;
};

// Zahlungsangaben der Einrichtung; vollständig erst mit Name, Adresse, IBAN und Zahlungsfrist.
export type InvoiceSettings = {
  creditor: PostalAddress | null;
  iban: string;
  paymentDays: number | null;
  nextNumber: number;
};

export type InvoiceLine = Pick<BillingLine, "name" | "priceCents" | "fullDays" | "reduced" | "amountCents">;

export type Invoice = {
  id: string;
  number: number;
  month: string;
  residentId: string;
  resident: string;
  issuedOn: string;
  dueOn: string;
  currency: string;
  lines: InvoiceLine[];
  totalCents: number;
  recipient: PostalAddress;
  creditor: PostalAddress;
  iban: string;
  reference: string;
  author: string;
  createdAt: string;
  cancelled: { at: string; by: string; reason: string } | null;
  payments: InvoicePayment[];
  paidCents: number;
};

// Stand einer Person im Rechnungslauf eines Monats.
export type InvoiceRow = {
  residentId: string;
  name: string;
  room: string;
  // Anteil der Person laut Berechnung (null: keine Berechnung möglich).
  totalCents: number | null;
  warnings: string[];
  hasAddress: boolean;
  invoice: { id: string; number: number; totalCents: number; paidCents: number; dueOn: string } | null;
};

export type InvoiceRun = {
  month: string;
  today: string;
  currency: string;
  // Was fehlt, bevor Rechnungen erstellt werden können (leer: bereit).
  missing: string[];
  // Ob der Monat abgeschlossen ist (Rechnungen erst nach Monatsende).
  monthClosed: boolean;
  qrBill: boolean;
  rows: InvoiceRow[];
  cancelled: Array<{ id: string; number: number; name: string; reason: string }>;
};

export const formatInvoiceNumber = (number: number) => String(number).padStart(6, "0");

// ---------------------------------------------------------------- Zahlungen und offene Posten

export type InvoicePayment = {
  id: string;
  paidOn: string;
  amountCents: number;
  source: "manual" | "bank";
  note: string;
  author: string;
  cancelled: { at: string; reason: string } | null;
};

export type OpenItem = {
  invoiceId: string;
  number: number;
  month: string;
  residentId: string;
  name: string;
  recipient: string;
  issuedOn: string;
  dueOn: string;
  totalCents: number;
  paidCents: number;
  overdue: boolean;
};

export type OpenItems = { currency: string; today: string; items: OpenItem[]; totalOpenCents: number };

export const BANK_MATCH = {
  ready: "Wird verbucht",
  duplicate: "Bereits verbucht",
  no_match: "Keine passende Rechnung",
  paid: "Rechnung bereits bezahlt",
  too_much: "Höher als der offene Betrag",
  currency: "Andere Währung",
  no_date: "Ohne Buchungsdatum",
} as const;
export type BankMatch = keyof typeof BANK_MATCH;

export type BankImportLine = {
  bankReference: string;
  bookedOn: string;
  amountCents: number;
  reference: string;
  debtor: string;
  status: BankMatch;
  invoice: { id: string; number: number; name: string } | null;
};
