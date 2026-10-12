import { randomUUID } from "node:crypto";
import { calculateQRReferenceChecksum, calculateSCORReferenceChecksum, isIBANValid, isQRIBAN } from "swissqrbill/utils";
import { SwissQRBill } from "swissqrbill/svg";
import {
  ApiError,
  assertResident,
  assertUuid,
  auditStatement,
  iso,
  text,
  type ApiContext,
  type Row,
} from "@/lib/api-context";
import { currencyOf } from "@/lib/funds-shared";
import { organizationCountry } from "@/lib/organization-country";
import { residentAudit } from "@/lib/resident-audit";
import { assertWrite, loadRates, loadSettings, monthlyCalculations, today } from "@/lib/billing";
import {
  formatInvoiceNumber,
  type BillingLine,
  type Invoice,
  type InvoiceLine,
  type InvoiceRun,
  type InvoiceSettings,
  type PostalAddress,
} from "@/lib/billing-shared";

// Rechnungen für den Anteil der Person: je Person und abgeschlossenem Monat eine Rechnung mit fortlaufender Nummer.
// Die Positionen werden beim Erstellen festgehalten. Zahlteil als Schweizer QR-Rechnung (Bibliothek swissqrbill,
// prüft IBAN, Referenz und Adressen nach den Vorgaben von SIX), wenn die IBAN aus der Schweiz oder Liechtenstein ist.

const MONTH = /^\d{4}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

const ibanText = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
// QR-Rechnung nur mit Konten in der Schweiz oder in Liechtenstein.
export const qrCapable = (iban: string) => /^(CH|LI)/.test(iban) && isIBANValid(iban);

function address(input: unknown, label: string, withAddition = false): PostalAddress {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const result: PostalAddress = {
    name: text(value.name, 70),
    street: text(value.street, 70),
    building: text(value.building, 16),
    zip: text(value.zip, 16),
    city: text(value.city, 35),
    country: String(value.country ?? "")
      .trim()
      .toUpperCase(),
  };
  if (withAddition) result.addition = text(value.addition, 70);
  if (!result.name || !result.street || !result.zip || !result.city)
    throw new ApiError(`Bitte bei ${label} Name, Strasse, Postleitzahl und Ort angeben.`);
  if (!COUNTRY.test(result.country)) throw new ApiError(`Bitte bei ${label} das Land als Kürzel angeben (z. B. CH).`);
  return result;
}

export async function invoiceSettings(ctx: ApiContext): Promise<InvoiceSettings> {
  assertWrite(ctx);
  const [row] = (await ctx.sql`
    SELECT * FROM carecore_billing_settings WHERE organization_id = ${ctx.actor.organizationId}`) as Row[];
  return {
    creditor: row?.creditor_name
      ? {
          name: String(row.creditor_name),
          street: String(row.creditor_street ?? ""),
          building: String(row.creditor_building ?? ""),
          zip: String(row.creditor_zip ?? ""),
          city: String(row.creditor_city ?? ""),
          country: String(row.creditor_country ?? ""),
        }
      : null,
    iban: String(row?.iban ?? ""),
    paymentDays: row?.payment_days === null || row?.payment_days === undefined ? null : Number(row.payment_days),
    nextNumber: Number(row?.next_invoice_number ?? 1),
  };
}

// { creditor: {name, street, building, zip, city, country}, iban, paymentDays }
export async function saveInvoiceSettings(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const creditor = address(body.creditor, "der Einrichtung");
  const iban = ibanText(body.iban);
  if (!isIBANValid(iban)) throw new ApiError("Die IBAN ist ungültig.");
  const paymentDays = Number(body.paymentDays);
  if (!Number.isInteger(paymentDays) || paymentDays < 0 || paymentDays > 120)
    throw new ApiError("Bitte die Zahlungsfrist in Tagen angeben (0 bis 120).");
  const before = await invoiceSettings(ctx);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_billing_settings (organization_id, creditor_name, creditor_street, creditor_building,
        creditor_zip, creditor_city, creditor_country, iban, payment_days, updated_by)
      VALUES (${ctx.actor.organizationId}, ${creditor.name}, ${creditor.street}, ${creditor.building}, ${creditor.zip},
        ${creditor.city}, ${creditor.country}, ${iban}, ${paymentDays}, ${ctx.actor.id})
      ON CONFLICT (organization_id) DO UPDATE SET creditor_name = EXCLUDED.creditor_name,
        creditor_street = EXCLUDED.creditor_street, creditor_building = EXCLUDED.creditor_building,
        creditor_zip = EXCLUDED.creditor_zip, creditor_city = EXCLUDED.creditor_city,
        creditor_country = EXCLUDED.creditor_country, iban = EXCLUDED.iban, payment_days = EXCLUDED.payment_days,
        updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    auditStatement(
      ctx,
      "billing_settings",
      ctx.actor.organizationId,
      "payment_details",
      { creditor: before.creditor, paymentDays: before.paymentDays },
      { creditor, paymentDays, iban: `…${iban.slice(-4)}` },
    ),
  ]);
}

export async function billingAddress(ctx: ApiContext, residentInput: unknown): Promise<PostalAddress | null> {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const [row] = (await ctx.sql`
    SELECT * FROM carecore_resident_billing_addresses WHERE resident_id = ${residentId}`) as Row[];
  return row
    ? {
        name: String(row.name),
        addition: String(row.addition),
        street: String(row.street),
        building: String(row.building),
        zip: String(row.zip),
        city: String(row.city),
        country: String(row.country),
      }
    : null;
}

// Rechnungsadresse je Person ({ residentId, address }).
export async function saveBillingAddress(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const value = address(body.address, "der Rechnungsadresse", true);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_resident_billing_addresses (resident_id, organization_id, name, addition, street, building,
        zip, city, country, updated_by)
      VALUES (${residentId}, ${ctx.actor.organizationId}, ${value.name}, ${value.addition ?? ""}, ${value.street},
        ${value.building}, ${value.zip}, ${value.city}, ${value.country}, ${ctx.actor.id})
      ON CONFLICT (resident_id) DO UPDATE SET name = EXCLUDED.name, addition = EXCLUDED.addition,
        street = EXCLUDED.street, building = EXCLUDED.building, zip = EXCLUDED.zip, city = EXCLUDED.city,
        country = EXCLUDED.country, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "billing_address",
      entityId: residentId,
      action: "updated",
      after: { ...value },
    }),
  ]);
}

const monthEnd = (month: string) => {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
};

// Personen mit einem Aufenthalt im Monat (auch ausgetretene), mit Rechnungsadresse und bestehender Rechnung.
async function monthPeople(ctx: ApiContext, month: string) {
  const start = `${month}-01`;
  const end = monthEnd(month);
  return (await ctx.sql`
    SELECT r.id, r.last_name || ' ' || r.first_name AS name, COALESCE(ro.name, '') AS room,
      (a.resident_id IS NOT NULL) AS has_address,
      i.id AS invoice_id, i.number AS invoice_number, i.total_cents AS invoice_total,
      to_char(i.due_on, 'YYYY-MM-DD') AS invoice_due,
      (SELECT COALESCE(SUM(p.amount_cents), 0) FROM carecore_invoice_payments p
        WHERE p.invoice_id = i.id AND p.cancelled_at IS NULL) AS invoice_paid
    FROM carecore_residents r
    JOIN carecore_organizations o ON o.id = r.organization_id
    LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id
      ORDER BY (ended_at IS NULL) DESC, started_at DESC LIMIT 1) st ON TRUE
    LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
    LEFT JOIN carecore_resident_billing_addresses a ON a.resident_id = r.id
    LEFT JOIN carecore_invoices i ON i.resident_id = r.id AND i.month = ${month} AND i.cancelled_at IS NULL
    WHERE r.organization_id = ${ctx.actor.organizationId}
      AND EXISTS (SELECT 1 FROM carecore_resident_stays s WHERE s.resident_id = r.id
        AND (s.started_at AT TIME ZONE o.timezone)::date <= ${end}::date
        AND (s.ended_at IS NULL OR (s.ended_at AT TIME ZONE o.timezone)::date >= ${start}::date))
    ORDER BY r.last_name, r.first_name`) as Row[];
}

function missingSettings(settings: InvoiceSettings, dischargeDayBilled: boolean | null) {
  const missing: string[] = [];
  if (dischargeDayBilled === null) missing.push("Regel zum Austrittstag (unter „Taxen der Einrichtung“)");
  if (!settings.creditor) missing.push("Name und Adresse der Einrichtung");
  if (!settings.iban) missing.push("IBAN");
  if (settings.paymentDays === null) missing.push("Zahlungsfrist");
  return missing;
}

const personLines = (lines: BillingLine[]): InvoiceLine[] =>
  lines.map(({ name, priceCents, fullDays, reduced, amountCents }) => ({
    name,
    priceCents,
    fullDays,
    reduced,
    amountCents,
  }));

export async function invoiceRun(ctx: ApiContext, monthInput: unknown): Promise<InvoiceRun> {
  assertWrite(ctx);
  const [current, country, settings, billing, rates] = await Promise.all([
    today(ctx),
    organizationCountry(ctx),
    invoiceSettings(ctx),
    loadSettings(ctx),
    loadRates(ctx),
  ]);
  const previous = new Date(`${current.slice(0, 7)}-01T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const month =
    typeof monthInput === "string" && MONTH.test(monthInput) ? monthInput : previous.toISOString().slice(0, 7);
  const [people, cancelled] = await Promise.all([
    monthPeople(ctx, month),
    ctx.sql`
      SELECT i.id, i.number, i.cancel_reason, r.last_name || ' ' || r.first_name AS name
      FROM carecore_invoices i JOIN carecore_residents r ON r.id = i.resident_id
      WHERE i.organization_id = ${ctx.actor.organizationId} AND i.month = ${month} AND i.cancelled_at IS NOT NULL
      ORDER BY i.number` as Promise<Row[]>,
  ]);
  const calculations = await monthlyCalculations(
    ctx,
    month,
    people.map((row) => String(row.id)),
    rates,
    billing,
  );
  return {
    month,
    today: current,
    currency: currencyOf(country),
    missing: missingSettings(settings, billing.dischargeDayBilled),
    monthClosed: monthEnd(month) < current,
    qrBill: qrCapable(settings.iban),
    rows: people.map((row) => {
      const calculation = calculations.get(String(row.id));
      const own = calculation?.totals.find((total) => total.payer === "resident");
      return {
        residentId: String(row.id),
        name: String(row.name),
        room: String(row.room),
        totalCents: calculation ? (own?.amountCents ?? 0) : null,
        warnings: calculation?.warnings ?? [],
        hasAddress: Boolean(row.has_address),
        invoice: row.invoice_id
          ? {
              id: String(row.invoice_id),
              number: Number(row.invoice_number),
              totalCents: Number(row.invoice_total),
              paidCents: Number(row.invoice_paid),
              dueOn: String(row.invoice_due),
            }
          : null,
      };
    }),
    cancelled: cancelled.map((row) => ({
      id: String(row.id),
      number: Number(row.number),
      name: String(row.name),
      reason: String(row.cancel_reason),
    })),
  };
}

// Referenz aus der Rechnungsnummer: QR-Referenz bei QR-IBAN, sonst Creditor Reference (ISO 11649); ausserhalb von
// Schweiz und Liechtenstein ohne Referenz.
export function invoiceReference(iban: string, number: number) {
  if (!qrCapable(iban)) return "";
  if (isQRIBAN(iban)) {
    const body = String(number).padStart(26, "0");
    return body + calculateQRReferenceChecksum(body);
  }
  const body = String(number);
  return `RF${calculateSCORReferenceChecksum(body)}${body}`;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Rechnungen für die gewählten Personen eines abgeschlossenen Monats erstellen ({ month, residentIds }). Personen ohne
// Rechnungsadresse, ohne Betrag oder mit bestehender Rechnung werden übersprungen (mit Grund).
export async function createInvoices(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const run = await invoiceRun(ctx, body.month);
  if (typeof body.month !== "string" || body.month !== run.month) throw new ApiError("Der Monat ist ungültig.");
  if (run.missing.length) throw new ApiError(`Es fehlen noch: ${run.missing.join(", ")}.`);
  if (!run.monthClosed) throw new ApiError("Rechnungen gibt es erst nach Monatsende.");
  const wanted = Array.isArray(body.residentIds) ? new Set(body.residentIds.map(String)) : null;
  const settings = await invoiceSettings(ctx);
  const billing = await loadSettings(ctx);
  const rates = await loadRates(ctx);
  const candidates = run.rows.filter((row) => !wanted || wanted.has(row.residentId));
  const skipped: Array<{ residentId: string; name: string; reason: string }> = [];
  const ready = candidates.filter((row) => {
    const reason = row.invoice
      ? "bereits verrechnet"
      : !row.hasAddress
        ? "keine Rechnungsadresse"
        : !row.totalCents
          ? "kein Betrag für die Person"
          : "";
    if (reason) skipped.push({ residentId: row.residentId, name: row.name, reason });
    return !reason;
  });
  if (!ready.length) return { created: [] as Array<{ id: string; number: number }>, skipped };
  const calculations = await monthlyCalculations(
    ctx,
    run.month,
    ready.map((row) => row.residentId),
    rates,
    billing,
  );
  const addresses = (await ctx.sql`
    SELECT * FROM carecore_resident_billing_addresses WHERE resident_id = ANY(${ready.map((row) => row.residentId)})`) as Row[];
  const issuedOn = run.today;
  const dueOn = addDays(issuedOn, settings.paymentDays ?? 0);
  const creditor = settings.creditor as PostalAddress;
  // Nummern fortlaufend und ohne Lücken: Zähler prüfen, Rechnungen anlegen und Zähler weiterzählen in einer
  // Transaktion. Lief inzwischen ein anderer Rechnungslauf, bricht sie ab (erneut versuchen).
  const first = settings.nextNumber;
  const created: Array<{ id: string; number: number }> = [];
  const statements = ready.flatMap((row, index) => {
    const calculation = calculations.get(row.residentId);
    const own = (calculation?.lines ?? []).filter((line) => line.payer === "resident");
    const total = own.reduce((sum, line) => sum + line.amountCents, 0);
    const found = addresses.find((entry) => entry.resident_id === row.residentId);
    const recipient: PostalAddress = {
      name: String(found?.name ?? ""),
      addition: String(found?.addition ?? ""),
      street: String(found?.street ?? ""),
      building: String(found?.building ?? ""),
      zip: String(found?.zip ?? ""),
      city: String(found?.city ?? ""),
      country: String(found?.country ?? ""),
    };
    const number = first + index;
    const id = randomUUID();
    created.push({ id, number });
    return [
      ctx.sql`
        INSERT INTO carecore_invoices (id, organization_id, resident_id, month, number, issued_on, due_on, currency,
          lines, calculation, total_cents, recipient, creditor, reference, created_by)
        VALUES (${id}, ${ctx.actor.organizationId}, ${row.residentId}, ${run.month}, ${number}, ${issuedOn}, ${dueOn},
          ${run.currency}, ${JSON.stringify(personLines(own))}::jsonb, ${JSON.stringify(calculation)}::jsonb, ${total},
          ${JSON.stringify(recipient)}::jsonb, ${JSON.stringify({ ...creditor, iban: settings.iban })}::jsonb,
          ${invoiceReference(settings.iban, number)}, ${ctx.actor.id})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: row.residentId,
        entityType: "invoice",
        entityId: id,
        action: "created",
        after: { number, month: run.month, totalCents: total },
      }),
    ];
  });
  await ctx.sql
    .transaction([
      ctx.sql`
        SELECT carecore_assert(next_invoice_number = ${first}, 'INVOICE_COUNTER') FROM carecore_billing_settings
        WHERE organization_id = ${ctx.actor.organizationId} FOR UPDATE`,
      ...statements,
      ctx.sql`
        UPDATE carecore_billing_settings SET next_invoice_number = ${first + ready.length}
        WHERE organization_id = ${ctx.actor.organizationId}`,
    ])
    .catch((error) => {
      if (
        String(error).includes("INVOICE_COUNTER") ||
        String(error).includes("carecore_invoices_organization_id_number_key")
      )
        throw new ApiError("Gleichzeitig lief ein anderer Rechnungslauf. Bitte erneut versuchen.", 409);
      if (String(error).includes("carecore_invoices_month_idx"))
        throw new ApiError("Für eine Person wurde der Monat inzwischen verrechnet. Bitte neu laden.", 409);
      throw error;
    });
  return { created, skipped };
}

function mapInvoice(row: Row, payments: Row[]): Invoice {
  const list = payments.map((payment) => ({
    id: String(payment.id),
    paidOn: String(payment.paid_day),
    amountCents: Number(payment.amount_cents),
    source: payment.source === "bank" ? ("bank" as const) : ("manual" as const),
    note: String(payment.note),
    author: String(payment.author),
    cancelled: payment.cancelled_at
      ? { at: iso(payment.cancelled_at) ?? "", reason: String(payment.cancel_reason) }
      : null,
  }));
  const creditor = row.creditor as PostalAddress & { iban?: string };
  return {
    id: String(row.id),
    number: Number(row.number),
    month: String(row.month),
    residentId: String(row.resident_id),
    resident: String(row.resident_name),
    issuedOn: String(row.issued_day),
    dueOn: String(row.due_day),
    currency: String(row.currency),
    lines: row.lines as InvoiceLine[],
    totalCents: Number(row.total_cents),
    recipient: row.recipient as PostalAddress,
    creditor,
    iban: String(creditor.iban ?? ""),
    reference: String(row.reference),
    author: String(row.author),
    createdAt: iso(row.created_at) ?? "",
    cancelled: row.cancelled_at
      ? { at: iso(row.cancelled_at) ?? "", by: String(row.cancelled_by_name), reason: String(row.cancel_reason) }
      : null,
    payments: list,
    paidCents: list.filter((payment) => !payment.cancelled).reduce((sum, payment) => sum + payment.amountCents, 0),
  };
}

// Zahlteil als SVG (210 × 105 mm); null ausserhalb von Schweiz und Liechtenstein oder bei stornierten Rechnungen.
export function paymentPart(invoice: Invoice) {
  if (invoice.cancelled || !qrCapable(invoice.iban)) return null;
  const party = (value: PostalAddress) => ({
    name: value.name,
    address: value.street,
    ...(value.building ? { buildingNumber: value.building } : {}),
    zip: value.zip,
    city: value.city,
    country: value.country,
  });
  const svg = new SwissQRBill(
    {
      currency: invoice.currency === "EUR" ? "EUR" : "CHF",
      amount: invoice.totalCents / 100,
      creditor: { ...party(invoice.creditor), account: invoice.iban },
      debtor: party(invoice.recipient),
      ...(invoice.reference ? { reference: invoice.reference } : {}),
      message: `Rechnung ${formatInvoiceNumber(invoice.number)} · ${invoice.month.slice(5)}.${invoice.month.slice(0, 4)}`,
    },
    { language: "DE" },
  );
  return svg.toString();
}

export async function invoiceDetail(ctx: ApiContext, invoiceInput: unknown) {
  assertWrite(ctx);
  const id = assertUuid(invoiceInput, "Rechnung");
  const [row] = (await ctx.sql`
    SELECT i.*, to_char(i.issued_on, 'YYYY-MM-DD') AS issued_day, to_char(i.due_on, 'YYYY-MM-DD') AS due_day,
      r.first_name || ' ' || r.last_name AS resident_name, COALESCE(u.display_name, 'Unbekannt') AS author,
      COALESCE(c.display_name, 'Unbekannt') AS cancelled_by_name
    FROM carecore_invoices i
    JOIN carecore_residents r ON r.id = i.resident_id
    LEFT JOIN carecore_users u ON u.id = i.created_by
    LEFT JOIN carecore_users c ON c.id = i.cancelled_by
    WHERE i.id = ${id} AND i.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Rechnung nicht gefunden.", 404);
  const payments = (await ctx.sql`
    SELECT p.*, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_day, COALESCE(u.display_name, 'Bankdatei') AS author
    FROM carecore_invoice_payments p LEFT JOIN carecore_users u ON u.id = p.created_by
    WHERE p.invoice_id = ${id} ORDER BY p.paid_on, p.created_at`) as Row[];
  const invoice = mapInvoice(row, payments);
  return { invoice, paymentPart: paymentPart(invoice) };
}

// Stornieren mit Grund; danach kann der Monat für die Person neu verrechnet werden.
export async function cancelInvoice(ctx: ApiContext, invoiceInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const id = assertUuid(invoiceInput, "Rechnung");
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  const [row] = (await ctx.sql`
    SELECT id, resident_id, number, cancelled_at,
      EXISTS (SELECT 1 FROM carecore_invoice_payments p WHERE p.invoice_id = i.id AND p.cancelled_at IS NULL) AS paid
    FROM carecore_invoices i WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Rechnung nicht gefunden.", 404);
  if (row.cancelled_at) throw new ApiError("Die Rechnung ist bereits storniert.", 409);
  if (row.paid) throw new ApiError("Zur Rechnung gibt es Zahlungen. Bitte diese zuerst stornieren.", 409);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_invoices SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id}, cancel_reason = ${reason}
      WHERE id = ${id} AND cancelled_at IS NULL`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId: String(row.resident_id),
      entityType: "invoice",
      entityId: id,
      action: "cancelled",
      after: { number: Number(row.number), reason },
    }),
  ]);
}
