import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, text, type ApiContext, type Row } from "@/lib/api-context";
import { currencyOf } from "@/lib/funds-shared";
import { organizationCountry } from "@/lib/organization-country";
import { residentAudit } from "@/lib/resident-audit";
import { assertWrite, loadRates, loadSettings, monthlyCalculations, today } from "@/lib/billing";
import { parseBankCredits } from "@/lib/camt";
import { PAYERS, type BankImportLine, type OpenItems } from "@/lib/billing-shared";

// Zahlungseingang, offene Posten und Exporte für die Buchhaltung. Zahlungen werden nicht geändert, sondern mit Grund
// storniert. Aus der Bankdatei (camt.054/053) werden nur Gutschriften verbucht, deren Referenz genau zu einer offenen
// Rechnung passt und die den offenen Betrag nicht übersteigen; alles andere wird mit Grund angezeigt.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

async function invoiceState(ctx: ApiContext, invoiceInput: unknown) {
  const id = assertUuid(invoiceInput, "Rechnung");
  const [row] = (await ctx.sql`
    SELECT i.id, i.resident_id, i.number, i.total_cents, i.currency, i.cancelled_at,
      (SELECT COALESCE(SUM(p.amount_cents), 0) FROM carecore_invoice_payments p
        WHERE p.invoice_id = i.id AND p.cancelled_at IS NULL) AS paid
    FROM carecore_invoices i WHERE i.id = ${id} AND i.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Rechnung nicht gefunden.", 404);
  return row;
}

// Prüfung in derselben Transaktion: eine Rechnung wird nie über ihren Betrag hinaus bezahlt.
const notOverpaid = (ctx: ApiContext, invoiceId: string) => ctx.sql`
  SELECT carecore_assert((SELECT COALESCE(SUM(amount_cents), 0) FROM carecore_invoice_payments
    WHERE invoice_id = ${invoiceId} AND cancelled_at IS NULL) <= (SELECT total_cents FROM carecore_invoices
    WHERE id = ${invoiceId}), 'INVOICE_OVERPAID')`;

// Zahlung von Hand ({ paidOn, amountCents, note }).
export async function addPayment(ctx: ApiContext, invoiceInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const invoice = await invoiceState(ctx, invoiceInput);
  if (invoice.cancelled_at) throw new ApiError("Die Rechnung ist storniert.", 409);
  const paidOn = typeof body.paidOn === "string" && DATE.test(body.paidOn) ? body.paidOn : null;
  if (!paidOn) throw new ApiError("Das Datum der Zahlung ist ungültig.");
  if (paidOn > (await today(ctx))) throw new ApiError("Zahlungen in der Zukunft sind nicht möglich.");
  const amount = Number(body.amountCents);
  const open = Number(invoice.total_cents) - Number(invoice.paid);
  if (!Number.isInteger(amount) || amount <= 0) throw new ApiError("Der Betrag ist ungültig.");
  if (amount > open) throw new ApiError("Der Betrag ist höher als der offene Betrag der Rechnung.");
  const id = randomUUID();
  const invoiceId = String(invoice.id);
  await ctx.sql
    .transaction([
      ctx.sql`SELECT id FROM carecore_invoices WHERE id = ${invoiceId} FOR UPDATE`,
      ctx.sql`
        INSERT INTO carecore_invoice_payments (id, organization_id, invoice_id, paid_on, amount_cents, source, note, created_by)
        VALUES (${id}, ${ctx.actor.organizationId}, ${invoiceId}, ${paidOn}, ${amount}, 'manual', ${text(body.note, 500)},
          ${ctx.actor.id})`,
      notOverpaid(ctx, invoiceId),
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(invoice.resident_id),
        entityType: "invoice_payment",
        entityId: id,
        action: "created",
        after: { number: Number(invoice.number), paidOn, amountCents: amount },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("INVOICE_OVERPAID"))
        throw new ApiError("Der Betrag ist höher als der offene Betrag der Rechnung.", 409);
      throw error;
    });
  return { id };
}

export async function cancelPayment(ctx: ApiContext, paymentInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const id = assertUuid(paymentInput, "Zahlung");
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  const [row] = (await ctx.sql`
    SELECT p.id, p.cancelled_at, p.amount_cents, i.resident_id, i.number FROM carecore_invoice_payments p
    JOIN carecore_invoices i ON i.id = p.invoice_id
    WHERE p.id = ${id} AND p.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Zahlung nicht gefunden.", 404);
  if (row.cancelled_at) throw new ApiError("Die Zahlung ist bereits storniert.", 409);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_invoice_payments SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id}, cancel_reason = ${reason}
      WHERE id = ${id} AND cancelled_at IS NULL`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId: String(row.resident_id),
      entityType: "invoice_payment",
      entityId: id,
      action: "cancelled",
      after: { number: Number(row.number), amountCents: Number(row.amount_cents), reason },
    }),
  ]);
}

// Offene Posten: gültige Rechnungen mit offenem Betrag, die ältesten Fälligkeiten zuerst.
export async function openItems(ctx: ApiContext): Promise<OpenItems> {
  assertWrite(ctx);
  const [current, country] = await Promise.all([today(ctx), organizationCountry(ctx)]);
  const rows = (await ctx.sql`
    SELECT i.id, i.number, i.month, i.resident_id, i.total_cents, i.recipient,
      to_char(i.issued_on, 'YYYY-MM-DD') AS issued_day, to_char(i.due_on, 'YYYY-MM-DD') AS due_day,
      r.last_name || ' ' || r.first_name AS name,
      (SELECT COALESCE(SUM(p.amount_cents), 0) FROM carecore_invoice_payments p
        WHERE p.invoice_id = i.id AND p.cancelled_at IS NULL) AS paid
    FROM carecore_invoices i JOIN carecore_residents r ON r.id = i.resident_id
    WHERE i.organization_id = ${ctx.actor.organizationId} AND i.cancelled_at IS NULL
    ORDER BY i.due_on, i.number`) as Row[];
  const items = rows
    .filter((row) => Number(row.paid) < Number(row.total_cents))
    .map((row) => ({
      invoiceId: String(row.id),
      number: Number(row.number),
      month: String(row.month),
      residentId: String(row.resident_id),
      name: String(row.name),
      recipient: String((row.recipient as { name?: string })?.name ?? ""),
      issuedOn: String(row.issued_day),
      dueOn: String(row.due_day),
      totalCents: Number(row.total_cents),
      paidCents: Number(row.paid),
      overdue: String(row.due_day) < current,
    }));
  return {
    currency: currencyOf(country),
    today: current,
    items,
    totalOpenCents: items.reduce((sum, item) => sum + item.totalCents - item.paidCents, 0),
  };
}

const MAX_BANK_FILE = 5_000_000;

// Gutschriften der Bankdatei den Rechnungen zuordnen (ohne zu verbuchen).
export async function bankImportPreview(ctx: ApiContext, body: Record<string, unknown>): Promise<BankImportLine[]> {
  assertWrite(ctx);
  const xml = typeof body.xml === "string" ? body.xml : "";
  if (!xml.trim()) throw new ApiError("Bitte eine Bankdatei wählen.");
  if (xml.length > MAX_BANK_FILE) throw new ApiError("Die Bankdatei ist zu gross (höchstens 5 MB).");
  let credits;
  try {
    credits = parseBankCredits(xml);
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "Die Bankdatei konnte nicht gelesen werden.");
  }
  const references = [...new Set(credits.map((credit) => credit.reference).filter(Boolean))];
  const bankReferences = credits.map((credit) => credit.bankReference).filter(Boolean);
  const [invoices, booked, country] = await Promise.all([
    ctx.sql`
      SELECT i.id, i.number, i.reference, i.total_cents, i.currency, r.last_name || ' ' || r.first_name AS name,
        (SELECT COALESCE(SUM(p.amount_cents), 0) FROM carecore_invoice_payments p
          WHERE p.invoice_id = i.id AND p.cancelled_at IS NULL) AS paid
      FROM carecore_invoices i JOIN carecore_residents r ON r.id = i.resident_id
      WHERE i.organization_id = ${ctx.actor.organizationId} AND i.cancelled_at IS NULL
        AND i.reference = ANY(${references})` as Promise<Row[]>,
    ctx.sql`
      SELECT bank_reference FROM carecore_invoice_payments WHERE organization_id = ${ctx.actor.organizationId}
        AND cancelled_at IS NULL AND bank_reference = ANY(${bankReferences})` as Promise<Row[]>,
    organizationCountry(ctx),
  ]);
  const seen = new Set(booked.map((row) => String(row.bank_reference)));
  // Mehrere Gutschriften derselben Rechnung in einer Datei: der offene Betrag wird der Reihe nach verbraucht.
  const open = new Map(invoices.map((row) => [String(row.reference), Number(row.total_cents) - Number(row.paid)]));
  return credits.map((credit) => {
    const invoice = invoices.find((row) => String(row.reference) === credit.reference && credit.reference);
    const base = {
      bankReference: credit.bankReference,
      bookedOn: credit.bookedOn,
      amountCents: credit.amountCents,
      reference: credit.reference,
      debtor: credit.debtor,
      invoice: invoice ? { id: String(invoice.id), number: Number(invoice.number), name: String(invoice.name) } : null,
    };
    if (!credit.bankReference || seen.has(credit.bankReference)) return { ...base, status: "duplicate" as const };
    if (!credit.bookedOn) return { ...base, status: "no_date" as const };
    if (!invoice) return { ...base, status: "no_match" as const };
    const currency = credit.currency || currencyOf(country);
    if (currency !== String(invoice.currency)) return { ...base, status: "currency" as const };
    const remaining = open.get(credit.reference) ?? 0;
    if (remaining <= 0) return { ...base, status: "paid" as const };
    if (credit.amountCents > remaining) return { ...base, status: "too_much" as const };
    open.set(credit.reference, remaining - credit.amountCents);
    seen.add(credit.bankReference);
    return { ...base, status: "ready" as const };
  });
}

// Zugeordnete Gutschriften verbuchen (dieselbe Datei wie in der Vorschau).
export async function bankImportBook(ctx: ApiContext, body: Record<string, unknown>) {
  const lines = await bankImportPreview(ctx, body);
  const ready = lines.filter((line) => line.status === "ready" && line.invoice);
  if (!ready.length) return { booked: 0, lines };
  const residents = (await ctx.sql`
    SELECT id, resident_id FROM carecore_invoices WHERE id = ANY(${ready.map((line) => line.invoice?.id ?? "")})`) as Row[];
  const residentOf = new Map(residents.map((row) => [String(row.id), String(row.resident_id)]));
  const statements = ready.flatMap((line) => {
    const id = randomUUID();
    const invoiceId = line.invoice?.id ?? "";
    return [
      ctx.sql`
        INSERT INTO carecore_invoice_payments (id, organization_id, invoice_id, paid_on, amount_cents, source,
          bank_reference, note, created_by)
        VALUES (${id}, ${ctx.actor.organizationId}, ${invoiceId}, ${line.bookedOn},
          ${line.amountCents}, 'bank', ${line.bankReference}, ${line.debtor ? `Bankdatei · ${line.debtor}` : "Bankdatei"},
          ${ctx.actor.id})`,
      notOverpaid(ctx, invoiceId),
      residentAudit(ctx.sql, ctx.actor, {
        residentId: residentOf.get(invoiceId) ?? "",
        entityType: "invoice_payment",
        entityId: id,
        action: "imported",
        after: { number: line.invoice?.number, paidOn: line.bookedOn, amountCents: line.amountCents },
      }),
    ];
  });
  await ctx.sql.transaction(statements).catch((error) => {
    if (String(error).includes("INVOICE_OVERPAID") || String(error).includes("carecore_invoice_payments_bank_idx"))
      throw new ApiError("Die Zahlungen haben sich inzwischen geändert. Bitte die Datei erneut einlesen.", 409);
    throw error;
  });
  return { booked: ready.length, lines };
}

// ---------------------------------------------------------------- Exporte (CSV)

// Rechnungsjournal eines Monats für die Finanzbuchhaltung.
export async function invoiceJournal(ctx: ApiContext, monthInput: unknown) {
  assertWrite(ctx);
  const month = typeof monthInput === "string" && MONTH.test(monthInput) ? monthInput : null;
  if (!month) throw new ApiError("Der Monat ist ungültig.");
  const rows = (await ctx.sql`
    SELECT i.number, to_char(i.issued_on, 'YYYY-MM-DD') AS issued_day, to_char(i.due_on, 'YYYY-MM-DD') AS due_day,
      i.total_cents, i.currency, i.reference, i.recipient, i.cancelled_at, i.cancel_reason,
      r.last_name || ' ' || r.first_name AS name,
      (SELECT COALESCE(SUM(p.amount_cents), 0) FROM carecore_invoice_payments p
        WHERE p.invoice_id = i.id AND p.cancelled_at IS NULL) AS paid
    FROM carecore_invoices i JOIN carecore_residents r ON r.id = i.resident_id
    WHERE i.organization_id = ${ctx.actor.organizationId} AND i.month = ${month}
    ORDER BY i.number`) as Row[];
  const amount = (cents: number) => cents / 100;
  return [
    [
      "Rechnungsnummer",
      "Rechnungsdatum",
      "Fällig am",
      "Für",
      "Rechnungsempfänger",
      "Betrag",
      "Bezahlt",
      "Offen",
      "Währung",
      "Zahlungsreferenz",
      "Status",
    ],
    ...rows.map((row) => {
      const total = Number(row.total_cents);
      const paid = Number(row.paid);
      return [
        Number(row.number),
        String(row.issued_day),
        String(row.due_day),
        String(row.name),
        String((row.recipient as { name?: string })?.name ?? ""),
        amount(total),
        amount(paid),
        row.cancelled_at ? 0 : amount(total - paid),
        String(row.currency),
        String(row.reference),
        row.cancelled_at
          ? `Storniert: ${row.cancel_reason}`
          : paid >= total
            ? "Bezahlt"
            : paid > 0
              ? "Teilweise bezahlt"
              : "Offen",
      ];
    }),
  ];
}

// Anteile von Krankenversicherung, öffentlicher Hand und anderen je Person für einen Monat (aus der Berechnung; diese
// Kostenträger erhalten keine Rechnung über CareOS, sondern werden mit dieser Liste abgerechnet).
export async function payerStatement(ctx: ApiContext, monthInput: unknown) {
  assertWrite(ctx);
  const month = typeof monthInput === "string" && MONTH.test(monthInput) ? monthInput : null;
  if (!month) throw new ApiError("Der Monat ist ungültig.");
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  const [people, rates, settings] = await Promise.all([
    ctx.sql`
      SELECT r.id, r.last_name || ' ' || r.first_name AS name, to_char(r.date_of_birth, 'YYYY-MM-DD') AS birth_day,
        COALESCE(r.insurer, '') AS insurer, COALESCE(r.insurance_number, '') AS insurance_number
      FROM carecore_residents r JOIN carecore_organizations o ON o.id = r.organization_id
      WHERE r.organization_id = ${ctx.actor.organizationId}
        AND EXISTS (SELECT 1 FROM carecore_resident_stays s WHERE s.resident_id = r.id
          AND (s.started_at AT TIME ZONE o.timezone)::date <= ${end}::date
          AND (s.ended_at IS NULL OR (s.ended_at AT TIME ZONE o.timezone)::date >= ${`${month}-01`}::date))
      ORDER BY r.last_name, r.first_name` as Promise<Row[]>,
    loadRates(ctx),
    loadSettings(ctx),
  ]);
  if (settings.dischargeDayBilled === null) throw new ApiError("Bitte zuerst die Regel zum Austrittstag festlegen.");
  const calculations = await monthlyCalculations(
    ctx,
    month,
    people.map((row) => String(row.id)),
    rates,
    settings,
  );
  const lines: Array<Array<string | number>> = [
    [
      "Kostenträger",
      "Person",
      "Geburtsdatum",
      "Versicherung",
      "Versichertennummer",
      "Position",
      "Preis je Tag",
      "Tage voll",
      "Tage reduziert",
      "Betrag",
    ],
  ];
  for (const person of people) {
    const calculation = calculations.get(String(person.id));
    for (const line of calculation?.lines ?? []) {
      if (line.payer === "resident") continue;
      lines.push([
        PAYERS[line.payer],
        String(person.name),
        String(person.birth_day ?? ""),
        String(person.insurer),
        String(person.insurance_number),
        line.name,
        line.priceCents / 100,
        line.fullDays,
        line.reduced.map((entry) => `${entry.days} zu ${entry.percent} %`).join(", "),
        line.amountCents / 100,
      ]);
    }
  }
  return lines;
}
