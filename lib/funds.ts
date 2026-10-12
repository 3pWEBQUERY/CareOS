import { randomUUID } from "node:crypto";
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
import { organizationCountry } from "@/lib/organization-country";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import { FUND_KINDS, currencyOf, type FundAccount, type FundCash, type FundKind } from "@/lib/funds-shared";

// Bewohnergelder (Barbetrag, Taschengeld): Konto je Person in der Kasse der Einrichtung. Buchungen bleiben
// unverändert; Fehler werden mit Grund storniert. Ein Guthaben kann nicht unter null fallen (Bargeld kann nicht fehlen,
// ohne dass es auffällt). Die Kassenkontrolle vergleicht den gezählten Bestand mit der Summe aller Guthaben.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const MAX_CENTS = 100_000_000;

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "funds.manage")) throw new ApiError("Keine Berechtigung.", 403);
}

async function today(ctx: ApiContext) {
  const [row] = (await ctx.sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(row.day);
}

const cents = (value: unknown) => Number(value ?? 0);

// Prüfung in derselben Transaktion: das Guthaben der Person bleibt nach der Änderung bei null oder darüber.
const balanceCheck = (ctx: ApiContext, residentId: string) => ctx.sql`
  SELECT carecore_assert((
    SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0)
    FROM carecore_fund_entries WHERE resident_id = ${residentId} AND cancelled_at IS NULL) >= 0, 'FUNDS_NEGATIVE')`;

export async function fundAccount(ctx: ApiContext, residentInput: unknown, monthInput: unknown): Promise<FundAccount> {
  const residentId = await assertResident(ctx, residentInput);
  const day = await today(ctx);
  const month = typeof monthInput === "string" && MONTH.test(monthInput) ? monthInput : day.slice(0, 7);
  const start = `${month}-01`;
  const [entries, sums, country, people] = await Promise.all([
    ctx.sql`
      SELECT e.*, to_char(e.booked_on, 'YYYY-MM-DD') AS day, COALESCE(u.display_name, 'Unbekannt') AS author,
        COALESCE(c.display_name, 'Unbekannt') AS cancelled_by_name
      FROM carecore_fund_entries e
      LEFT JOIN carecore_users u ON u.id = e.author_user_id
      LEFT JOIN carecore_users c ON c.id = e.cancelled_by
      WHERE e.resident_id = ${residentId} AND e.booked_on >= ${start}::date
        AND e.booked_on < (${start}::date + INTERVAL '1 month')
      ORDER BY e.booked_on DESC, e.created_at DESC` as Promise<Row[]>,
    ctx.sql`
      SELECT
        COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0) AS balance,
        COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END)
          FILTER (WHERE booked_on < ${start}::date), 0) AS opening,
        COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END)
          FILTER (WHERE booked_on < (${start}::date + INTERVAL '1 month')), 0) AS closing
      FROM carecore_fund_entries WHERE resident_id = ${residentId} AND cancelled_at IS NULL` as Promise<Row[]>,
    organizationCountry(ctx),
    ctx.sql`
      SELECT r.last_name || ' ' || r.first_name AS name, to_char(r.date_of_birth, 'YYYY-MM-DD') AS birth_day,
        COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS unit
      FROM carecore_residents r
      LEFT JOIN carecore_resident_stays st ON st.resident_id = r.id AND st.ended_at IS NULL
      LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
      LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id
      WHERE r.id = ${residentId} LIMIT 1` as Promise<Row[]>,
  ]);
  const person = people[0];
  const active = entries.filter((row) => !row.cancelled_at);
  return {
    residentId,
    resident: {
      name: String(person?.name ?? ""),
      birthDate: (person?.birth_day as string | null) ?? null,
      room: String(person?.room ?? ""),
      unit: String(person?.unit ?? ""),
    },
    currency: currencyOf(country),
    canWrite: hasPermission(ctx.actor, "funds.manage"),
    today: day,
    balanceCents: cents(sums[0]?.balance),
    month,
    openingCents: cents(sums[0]?.opening),
    closingCents: cents(sums[0]?.closing),
    depositsCents: active
      .filter((row) => row.kind === "deposit")
      .reduce((sum, row) => sum + cents(row.amount_cents), 0),
    withdrawalsCents: active
      .filter((row) => row.kind !== "deposit")
      .reduce((sum, row) => sum + cents(row.amount_cents), 0),
    entries: entries.map((row) => ({
      id: String(row.id),
      bookedOn: String(row.day),
      kind: row.kind as FundKind,
      amountCents: cents(row.amount_cents),
      purpose: String(row.purpose),
      party: String(row.party),
      receipt: String(row.receipt),
      author: String(row.author),
      createdAt: iso(row.created_at) ?? "",
      cancelled: row.cancelled_at
        ? { at: iso(row.cancelled_at) ?? "", by: String(row.cancelled_by_name), reason: String(row.cancel_reason) }
        : null,
    })),
  };
}

const negative = (error: unknown) => {
  if (String(error).includes("FUNDS_NEGATIVE"))
    throw new ApiError("Das Guthaben reicht dafür nicht aus. Es kann nicht unter null fallen.", 409);
  throw error;
};

// Buchung erfassen ({ residentId, kind, amountCents, bookedOn, purpose, party, receipt }).
export async function createFundEntry(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const kind = String(body.kind ?? "") as FundKind;
  if (!(kind in FUND_KINDS)) throw new ApiError("Bitte die Art der Buchung wählen.");
  const amount = Number(body.amountCents);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_CENTS) throw new ApiError("Der Betrag ist ungültig.");
  const purpose = text(body.purpose, 300);
  if (!purpose) throw new ApiError("Bitte den Zweck angeben.");
  const bookedOn = typeof body.bookedOn === "string" && DATE.test(body.bookedOn) ? body.bookedOn : null;
  if (!bookedOn) throw new ApiError("Das Datum ist ungültig.");
  if (bookedOn > (await today(ctx))) throw new ApiError("Buchungen in der Zukunft sind nicht möglich.");
  const party = text(body.party, 200);
  const receipt = text(body.receipt, 60);
  const id = randomUUID();
  await ctx.sql
    .transaction([
      // Gleichzeitige Buchungen derselben Person nacheinander, damit die Prüfung des Guthabens stimmt.
      ctx.sql`SELECT id FROM carecore_residents WHERE id = ${residentId} FOR UPDATE`,
      ctx.sql`
        INSERT INTO carecore_fund_entries (id, organization_id, resident_id, booked_on, kind, amount_cents, purpose,
          party, receipt, author_user_id)
        VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${bookedOn}, ${kind}, ${amount}, ${purpose},
          ${party}, ${receipt}, ${ctx.actor.id})`,
      balanceCheck(ctx, residentId),
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "fund_entry",
        entityId: id,
        action: "created",
        after: { kind, amountCents: amount, bookedOn, purpose, party, receipt },
      }),
    ])
    .catch(negative);
  return { id };
}

// Stornieren statt löschen: die Buchung bleibt sichtbar, mit Grund, zählt aber nicht mehr.
export async function cancelFundEntry(ctx: ApiContext, entryInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const entryId = assertUuid(entryInput, "Buchung");
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  const [entry] = (await ctx.sql`
    SELECT id, resident_id, cancelled_at, kind, amount_cents FROM carecore_fund_entries
    WHERE id = ${entryId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!entry) throw new ApiError("Buchung nicht gefunden.", 404);
  if (entry.cancelled_at) throw new ApiError("Die Buchung ist bereits storniert.", 409);
  const residentId = String(entry.resident_id);
  await ctx.sql
    .transaction([
      ctx.sql`SELECT id FROM carecore_residents WHERE id = ${residentId} FOR UPDATE`,
      ctx.sql`
        WITH changed AS (UPDATE carecore_fund_entries SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id},
          cancel_reason = ${reason} WHERE id = ${entryId} AND cancelled_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ENTRY_CANCELLED')`,
      balanceCheck(ctx, residentId),
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "fund_entry",
        entityId: entryId,
        action: "cancelled",
        before: { kind: entry.kind, amountCents: cents(entry.amount_cents) },
        after: { reason },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("ENTRY_CANCELLED")) throw new ApiError("Die Buchung ist bereits storniert.", 409);
      if (String(error).includes("FUNDS_NEGATIVE"))
        throw new ApiError(
          "Ohne diese Einzahlung fiele das Guthaben unter null. Bitte zuerst die späteren Ausgaben stornieren.",
          409,
        );
      throw error;
    });
}

// Kasse: Guthaben aller Personen mit Buchungen und die letzten Kassenkontrollen.
export async function fundCash(ctx: ApiContext): Promise<FundCash> {
  assertWrite(ctx);
  const org = ctx.actor.organizationId;
  const [accounts, counts, country] = await Promise.all([
    ctx.sql`
      SELECT r.id, r.last_name || ' ' || r.first_name AS name, r.status, COALESCE(ro.name, '') AS room,
        COALESCE(cu.name, '') AS unit,
        SUM(CASE WHEN e.kind = 'deposit' THEN e.amount_cents ELSE -e.amount_cents END) AS balance
      FROM carecore_fund_entries e
      JOIN carecore_residents r ON r.id = e.resident_id
      LEFT JOIN carecore_resident_stays st ON st.resident_id = r.id AND st.ended_at IS NULL
      LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
      LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id
      WHERE e.organization_id = ${org} AND e.cancelled_at IS NULL
      GROUP BY r.id, r.last_name, r.first_name, r.status, ro.name, cu.name
      ORDER BY r.last_name, r.first_name` as Promise<Row[]>,
    ctx.sql`
      SELECT c.*, COALESCE(u.display_name, 'Unbekannt') AS counted_by_name
      FROM carecore_fund_counts c LEFT JOIN carecore_users u ON u.id = c.counted_by
      WHERE c.organization_id = ${org} ORDER BY c.counted_at DESC LIMIT 24` as Promise<Row[]>,
    organizationCountry(ctx),
  ]);
  const list = accounts.map((row) => ({
    residentId: String(row.id),
    name: String(row.name),
    room: String(row.room),
    unit: String(row.unit),
    active: row.status === "active",
    balanceCents: cents(row.balance),
  }));
  return {
    currency: currencyOf(country),
    canWrite: true,
    totalCents: list.reduce((sum, account) => sum + account.balanceCents, 0),
    accounts: list.filter((account) => account.active || account.balanceCents !== 0),
    counts: counts.map((row) => ({
      id: String(row.id),
      countedAt: iso(row.counted_at) ?? "",
      countedCents: cents(row.counted_cents),
      expectedCents: cents(row.expected_cents),
      witness: String(row.witness),
      note: String(row.note),
      countedBy: String(row.counted_by_name),
    })),
  };
}

// Kassenkontrolle erfassen ({ countedCents, witness, note }); bei einer Differenz ist die Bemerkung Pflicht.
export async function createFundCount(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const counted = Number(body.countedCents);
  if (!Number.isInteger(counted) || counted < 0 || counted > MAX_CENTS * 100)
    throw new ApiError("Der gezählte Betrag ist ungültig.");
  const witness = text(body.witness, 200);
  const note = text(body.note, 2000);
  const id = randomUUID();
  const org = ctx.actor.organizationId;
  const [row] = (await ctx.sql`
    SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0) AS expected
    FROM carecore_fund_entries WHERE organization_id = ${org} AND cancelled_at IS NULL`) as Row[];
  const differs = () =>
    new ApiError("Der gezählte Betrag weicht vom Sollbestand ab. Bitte die Differenz in der Bemerkung erklären.");
  if (cents(row?.expected) !== counted && !note) throw differs();
  // Sollbestand beim Speichern neu berechnet: zählt genau die Buchungen zum Zeitpunkt der Kontrolle.
  await ctx.sql
    .transaction([
      ctx.sql`
        INSERT INTO carecore_fund_counts (id, organization_id, counted_cents, expected_cents, witness, note, counted_by)
        SELECT ${id}, ${org}, ${counted},
          COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount_cents ELSE -amount_cents END), 0), ${witness}, ${note},
          ${ctx.actor.id}
        FROM carecore_fund_entries WHERE organization_id = ${org} AND cancelled_at IS NULL`,
      auditStatement(ctx, "fund_count", id, "created", null, { countedCents: counted, witness, note }),
    ])
    .catch((error) => {
      if (String(error).includes("carecore_fund_counts_check")) throw differs();
      throw error;
    });
  return { id };
}
