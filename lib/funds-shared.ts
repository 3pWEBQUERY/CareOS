// Bewohnergelder (Server und Oberfläche): Konto je Person in der Kasse der Einrichtung, Buchungen in Rappen bzw. Cent.
import type { CountryCode } from "@/lib/country";

export const FUND_KINDS = { deposit: "Einzahlung", payout: "Auszahlung", expense: "Ausgabe" } as const;
export type FundKind = keyof typeof FUND_KINDS;

// Einzahlungen erhöhen das Guthaben, Auszahlungen und Ausgaben verringern es.
export const fundSign = (kind: FundKind) => (kind === "deposit" ? 1 : -1);

export const currencyOf = (country: CountryCode) => (country === "CH" ? "CHF" : "EUR");

// Betrag mit Tausendertrennzeichen und zwei Nachkommastellen („CHF 1’234.50“ bzw. „EUR 1.234,50“).
export function formatMoney(cents: number, currency: string) {
  const locale = currency === "CHF" ? "de-CH" : "de-DE";
  const value = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    cents / 100,
  );
  return `${currency} ${value}`;
}

// Eingabe „12.50“, „12,50“, „1’234.5“ oder „1.234,50“ in Rappen bzw. Cent; ungültig: null.
export function parseMoney(input: string): number | null {
  const raw = input.trim().replace(/[’'\s]/g, "");
  if (!raw) return null;
  let normalized = raw;
  if (raw.includes(",") && raw.includes(".")) {
    normalized =
      raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (raw.includes(",")) normalized = raw.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

export type FundEntry = {
  id: string;
  bookedOn: string;
  kind: FundKind;
  amountCents: number;
  purpose: string;
  party: string;
  receipt: string;
  author: string;
  createdAt: string;
  cancelled: { at: string; by: string; reason: string } | null;
};

export type FundAccount = {
  residentId: string;
  // Für den Kontoauszug.
  resident: { name: string; birthDate: string | null; room: string; unit: string };
  currency: string;
  canWrite: boolean;
  today: string;
  // Guthaben heute (alle nicht stornierten Buchungen).
  balanceCents: number;
  month: string;
  // Stand zu Beginn und am Ende des Monats.
  openingCents: number;
  closingCents: number;
  depositsCents: number;
  withdrawalsCents: number;
  entries: FundEntry[];
};

export type FundCount = {
  id: string;
  countedAt: string;
  countedCents: number;
  expectedCents: number;
  witness: string;
  note: string;
  countedBy: string;
};

export type FundCash = {
  currency: string;
  canWrite: boolean;
  totalCents: number;
  accounts: Array<{
    residentId: string;
    name: string;
    room: string;
    unit: string;
    active: boolean;
    balanceCents: number;
  }>;
  counts: FundCount[];
};
