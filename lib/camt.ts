// Gutschriften aus einer Bankdatei im Format ISO 20022 camt.054 (Gutschriftsanzeige, z. B. für QR-Rechnungen) bzw.
// camt.053 (Kontoauszug) lesen. Reine Funktion ohne Datenbank. Gelesen werden nur Gutschriften (CRDT) mit Betrag,
// Buchungsdatum, Zahlungsreferenz und der Referenz der Bank (verhindert doppeltes Verbuchen).
import { XMLParser } from "fast-xml-parser";

export type BankCredit = {
  // Referenz der Bank für die einzelne Gutschrift (eindeutig).
  bankReference: string;
  bookedOn: string;
  amountCents: number;
  currency: string;
  // QR-Referenz oder Creditor Reference aus der Zahlung; leer, wenn ohne strukturierte Referenz.
  reference: string;
  debtor: string;
};

type Node = Record<string, unknown>;

const LISTS = new Set(["Ntfctn", "Stmt", "Ntry", "NtryDtls", "TxDtls", "Strd"]);

const list = (value: unknown): Node[] =>
  Array.isArray(value) ? (value as Node[]) : value && typeof value === "object" ? [value as Node] : [];

const textOf = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return textOf((value as Node)["#text"]);
  return String(value).trim();
};

function get(node: unknown, path: string): unknown {
  let current: unknown = node;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    const next = (current as Node)[key];
    current = Array.isArray(next) ? next[0] : next;
  }
  return current;
}

// Betrag in Rappen bzw. Cent aus einem Amt-Element („1234.50“ mit Attribut Ccy).
function amountOf(value: unknown) {
  const raw = textOf(value);
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return {
    cents: Number(whole) * 100 + Number(fraction.padEnd(2, "0")),
    currency: value && typeof value === "object" ? String((value as Node)["@_Ccy"] ?? "") : "",
  };
}

const dateOf = (node: unknown) => {
  const raw = textOf(get(node, "BookgDt.Dt")) || textOf(get(node, "BookgDt.DtTm")) || textOf(get(node, "ValDt.Dt"));
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
};

export function parseBankCredits(xml: string): BankCredit[] {
  // Bankdateien brauchen keine eigenen Entitäten; solche Dateien werden abgelehnt (Schutz vor Entitäts-Angriffen).
  if (/<!(DOCTYPE|ENTITY)/i.test(xml)) throw new Error("Die Datei enthält nicht erlaubte Angaben (DOCTYPE).");
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => LISTS.has(name),
  });
  let document: Node;
  try {
    document = parser.parse(xml) as Node;
  } catch {
    throw new Error("Die Datei ist kein gültiges XML.");
  }
  const root = (document.Document ?? {}) as Node;
  const message = (root.BkToCstmrDbtCdtNtfctn ?? root.BkToCstmrStmt) as Node | undefined;
  if (!message) throw new Error("Die Datei ist keine Bankdatei im Format camt.054 oder camt.053.");
  const reports = [...list(message.Ntfctn), ...list(message.Stmt)];
  const credits: BankCredit[] = [];
  for (const report of reports)
    for (const entry of list(report.Ntry)) {
      if (textOf(entry.CdtDbtInd) !== "CRDT") continue;
      if (textOf(get(entry, "RvslInd")) === "true") continue;
      const bookedOn = dateOf(entry);
      const entryAmount = amountOf(entry.Amt);
      const entryReference = textOf(entry.AcctSvcrRef);
      const transactions = list(entry.NtryDtls).flatMap((details) => list(details.TxDtls));
      // Sammelbuchung ohne Einzelheiten: eine Gutschrift für den ganzen Eintrag.
      const items = transactions.length ? transactions : [entry];
      items.forEach((transaction, index) => {
        const amount =
          amountOf(transaction.Amt) ??
          amountOf(get(transaction, "AmtDtls.TxAmt.Amt")) ??
          (items.length === 1 ? entryAmount : null);
        if (!amount) return;
        const strd = list(get(transaction, "RmtInf") && (get(transaction, "RmtInf") as Node).Strd);
        const reference = strd.map((item) => textOf(get(item, "CdtrRefInf.Ref"))).find(Boolean) ?? "";
        const bankReference =
          textOf(get(transaction, "Refs.AcctSvcrRef")) ||
          (entryReference ? `${entryReference}${items.length > 1 ? `/${index + 1}` : ""}` : "");
        credits.push({
          bankReference,
          bookedOn,
          amountCents: amount.cents,
          currency: amount.currency || entryAmount?.currency || "",
          reference: reference.replace(/\s+/g, ""),
          debtor: textOf(get(transaction, "RltdPties.Dbtr.Nm")) || textOf(get(transaction, "RltdPties.Dbtr.Pty.Nm")),
        });
      });
    }
  return credits;
}
