// Betäubungsmittel (BtM): Antworten der API und Anzeige (Server und Browser).

export type BtmStockItem = {
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
  lastMovementAt: string | null;
  // null, solange kein Kontrollintervall festgelegt ist; at = null: noch nie kontrolliert (sofort fällig).
  countDue: { at: string | null; due: boolean } | null;
  lastCount: { at: string; expected: number; counted: number; countedBy: string | null; witness: string | null } | null;
};

export type BtmOverview = {
  countInterval: number | null;
  items: BtmStockItem[];
  medications: Array<{ id: string; name: string; form: string; controlled: boolean; hasStock: boolean }>;
};

export type BtmBookEntry = {
  id: string;
  at: string;
  kind: "receipt" | "administration" | "correction" | "disposal" | "count";
  delta: number;
  balance: number;
  note: string | null;
  user: string | null;
  witness: string | null;
  resident: string | null;
  expected: number | null;
  counted: number | null;
};

export type BtmBook = {
  stock: { id: string; name: string; owner: string; unit: string; quantity: number; controlled: boolean };
  opening: number;
  entries: BtmBookEntry[];
};

export const BTM_KIND_LABELS: Record<BtmBookEntry["kind"], string> = {
  receipt: "Eingang",
  administration: "Gabe",
  correction: "Korrektur",
  disposal: "Entsorgung",
  count: "Bestandskontrolle",
};

export type WitnessInput = { username: string; password: string };
