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
import { COUNTRIES } from "@/lib/country";
import { currencyOf } from "@/lib/funds-shared";
import { organizationCountry } from "@/lib/organization-country";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import { computeMonth } from "@/lib/billing-calc";
import {
  ABSENCE_KINDS,
  PAYERS,
  RATE_CATEGORIES,
  type AbsenceKind,
  type AbsenceRule,
  type BillingCatalog,
  type BillingMonth,
  type BillingPerson,
  type BillingRate,
  type BillingSettings,
  type Payer,
  type RateCategory,
} from "@/lib/billing-shared";

// Abrechnung, Grundlagen: Taxen der Einrichtung (Preis je Tag ab einem Datum), Pflegestufe je Person mit Verlauf,
// Abwesenheiten und zusätzliche Taxen. Die Monatsvorschau rechnet jeden Tag einzeln (lib/billing-calc.ts).
// Alle Tarife und Regeln kommen von der Einrichtung; CareOS gibt keine Beträge vor.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const MAX_CENTS = 10_000_000;

export function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "billing.manage")) throw new ApiError("Keine Berechtigung.", 403);
}

const date = (value: unknown, label: string) => {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new ApiError(`${label} ist ungültig.`);
  return value;
};
const optionalDate = (value: unknown, label: string) => (value ? date(value, label) : null);
const amount = (value: unknown) => {
  const cents = Number(value);
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_CENTS) throw new ApiError("Der Betrag ist ungültig.");
  return cents;
};
// Nur für Werte, die SQL bereits als „YYYY-MM-DD“ liefert (to_char).
const day = (value: unknown) => (value ? String(value).slice(0, 10) : null);

export async function today(ctx: ApiContext) {
  const [row] = (await ctx.sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(row.day);
}

function rule(value: unknown, label: string): AbsenceRule {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object") throw new ApiError(`Die Regel bei ${label} ist ungültig.`);
  const input = value as Record<string, unknown>;
  const fullDays = Number(input.fullDays);
  const percent = Number(input.percent);
  if (!Number.isInteger(fullDays) || fullDays < 0 || fullDays > 365)
    throw new ApiError(`Bitte bei ${label} die Anzahl Tage mit vollem Betrag angeben (0 bis 365).`);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100)
    throw new ApiError(`Bitte bei ${label} den Prozentsatz angeben (0 bis 100).`);
  return { fullDays, percent };
}

const readRule = (days: unknown, percent: unknown): AbsenceRule =>
  days === null || days === undefined ? null : { fullDays: Number(days), percent: Number(percent) };

export async function loadSettings(ctx: ApiContext): Promise<BillingSettings> {
  const [row] = (await ctx.sql`
    SELECT discharge_day_billed FROM carecore_billing_settings WHERE organization_id = ${ctx.actor.organizationId}`) as Row[];
  return { dischargeDayBilled: row ? ((row.discharge_day_billed as boolean | null) ?? null) : null };
}

export async function loadRates(ctx: ApiContext): Promise<BillingRate[]> {
  const [rates, prices] = (await Promise.all([
    ctx.sql`
      SELECT * FROM carecore_billing_rates WHERE organization_id = ${ctx.actor.organizationId}
      ORDER BY archived_at IS NOT NULL, position, created_at`,
    ctx.sql`
      SELECT p.rate_id, to_char(p.valid_from, 'YYYY-MM-DD') AS valid_from, p.amount_cents
      FROM carecore_billing_rate_prices p JOIN carecore_billing_rates r ON r.id = p.rate_id
      WHERE r.organization_id = ${ctx.actor.organizationId} ORDER BY p.valid_from`,
  ])) as Row[][];
  return rates.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: row.category as RateCategory,
    payer: row.payer as Payer,
    careLevel: (row.care_level as string | null) ?? null,
    applies: row.applies === "assigned" ? "assigned" : "all",
    hospital: readRule(row.hospital_full_days, row.hospital_percent),
    absence: readRule(row.absence_full_days, row.absence_percent),
    prices: prices
      .filter((price) => price.rate_id === row.id)
      .map((price) => ({ validFrom: String(price.valid_from), amountCents: Number(price.amount_cents) })),
    archived: Boolean(row.archived_at),
  }));
}

// ---------------------------------------------------------------- Taxen der Einrichtung

export async function billingCatalog(ctx: ApiContext): Promise<BillingCatalog> {
  assertWrite(ctx);
  const [country, rates, settings, day] = await Promise.all([
    organizationCountry(ctx),
    loadRates(ctx),
    loadSettings(ctx),
    today(ctx),
  ]);
  return {
    currency: currencyOf(country),
    today: day,
    levels: COUNTRIES[country].careLevels.levels,
    levelLabel: COUNTRIES[country].careLevels.label,
    rates,
    settings,
  };
}

async function rateById(ctx: ApiContext, rateInput: unknown) {
  const rateId = assertUuid(rateInput, "Taxe");
  const [row] = (await ctx.sql`
    SELECT * FROM carecore_billing_rates WHERE id = ${rateId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Taxe nicht gefunden.", 404);
  return row;
}

async function assertLevel(ctx: ApiContext, value: unknown) {
  const level = typeof value === "string" ? value : "";
  const country = await organizationCountry(ctx);
  if (!COUNTRIES[country].careLevels.levels.some((entry) => entry.value === level))
    throw new ApiError(`Bitte eine gültige ${COUNTRIES[country].careLevels.label} wählen.`);
  return level;
}

function rateFields(body: Record<string, unknown>) {
  const name = text(body.name, 160);
  if (!name) throw new ApiError("Bitte eine Bezeichnung angeben.");
  const payer = String(body.payer ?? "") as Payer;
  if (!(payer in PAYERS)) throw new ApiError("Bitte wählen, wer die Taxe bezahlt.");
  return {
    name,
    payer,
    applies: body.applies === "assigned" ? "assigned" : "all",
    hospital: rule(body.hospital, "Spitalaufenthalt"),
    absence: rule(body.absence, "Ferien und anderen Abwesenheiten"),
  };
}

// Neue Taxe ({ name, category, payer, careLevel?, applies, hospital, absence, validFrom, amountCents }).
export async function createRate(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const category = String(body.category ?? "") as RateCategory;
  if (!(category in RATE_CATEGORIES)) throw new ApiError("Bitte die Art der Taxe wählen.");
  const fields = rateFields(body);
  const careLevel = category === "care" ? await assertLevel(ctx, body.careLevel) : null;
  const applies = category === "care" ? "all" : fields.applies;
  const validFrom = date(body.validFrom, "Das Datum „gültig ab“");
  const cents = amount(body.amountCents);
  if (careLevel) {
    const [taken] = (await ctx.sql`
      SELECT id FROM carecore_billing_rates WHERE organization_id = ${ctx.actor.organizationId} AND category = 'care'
        AND care_level = ${careLevel} AND payer = ${fields.payer} AND archived_at IS NULL`) as Row[];
    if (taken)
      throw new ApiError(
        `Für „${careLevel}“ und ${PAYERS[fields.payer]} gibt es bereits einen Tarif. Bitte dort den Preis ändern.`,
        409,
      );
  }
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_billing_rates (id, organization_id, name, category, payer, care_level, applies,
        hospital_full_days, hospital_percent, absence_full_days, absence_percent, position, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${fields.name}, ${category}, ${fields.payer}, ${careLevel}, ${applies},
        ${fields.hospital?.fullDays ?? null}, ${fields.hospital?.percent ?? null}, ${fields.absence?.fullDays ?? null},
        ${fields.absence?.percent ?? null},
        (SELECT COALESCE(MAX(position), 0) + 1 FROM carecore_billing_rates WHERE organization_id = ${ctx.actor.organizationId}),
        ${ctx.actor.id})`,
    ctx.sql`
      INSERT INTO carecore_billing_rate_prices (id, rate_id, valid_from, amount_cents, created_by)
      VALUES (${randomUUID()}, ${id}, ${validFrom}, ${cents}, ${ctx.actor.id})`,
    auditStatement(ctx, "billing_rate", id, "created", null, {
      name: fields.name,
      category,
      payer: fields.payer,
      careLevel,
      validFrom,
      amountCents: cents,
    }),
  ]);
  return { id };
}

// Bezeichnung, Kostenträger, Geltung und Regeln bei Abwesenheit ändern (Preise über setRatePrice).
export async function updateRate(ctx: ApiContext, rateInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await rateById(ctx, rateInput);
  if (before.archived_at) throw new ApiError("Die Taxe wird nicht mehr verwendet.", 409);
  const fields = rateFields(body);
  const applies = before.category === "care" ? "all" : fields.applies;
  if (before.category === "care" && fields.payer !== before.payer)
    throw new ApiError("Bei Pflegetarifen lässt sich der Kostenträger nicht ändern.");
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_billing_rates SET name = ${fields.name}, payer = ${fields.payer}, applies = ${applies},
        hospital_full_days = ${fields.hospital?.fullDays ?? null}, hospital_percent = ${fields.hospital?.percent ?? null},
        absence_full_days = ${fields.absence?.fullDays ?? null}, absence_percent = ${fields.absence?.percent ?? null},
        updated_at = NOW()
      WHERE id = ${before.id}`,
    auditStatement(
      ctx,
      "billing_rate",
      String(before.id),
      "updated",
      { name: before.name, payer: before.payer, applies: before.applies },
      { name: fields.name, payer: fields.payer, applies, hospital: fields.hospital, absence: fields.absence },
    ),
  ]);
}

// Preis ab einem Datum ({ validFrom, amountCents }); ein Preis am selben Datum wird ersetzt.
export async function setRatePrice(ctx: ApiContext, rateInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const rate = await rateById(ctx, rateInput);
  if (rate.archived_at) throw new ApiError("Die Taxe wird nicht mehr verwendet.", 409);
  const validFrom = date(body.validFrom, "Das Datum „gültig ab“");
  const cents = amount(body.amountCents);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_billing_rate_prices (id, rate_id, valid_from, amount_cents, created_by)
      VALUES (${randomUUID()}, ${rate.id}, ${validFrom}, ${cents}, ${ctx.actor.id})
      ON CONFLICT (rate_id, valid_from) DO UPDATE SET amount_cents = EXCLUDED.amount_cents,
        created_by = EXCLUDED.created_by, created_at = NOW()`,
    auditStatement(ctx, "billing_rate", String(rate.id), "price_set", null, {
      name: rate.name,
      validFrom,
      amountCents: cents,
    }),
  ]);
}

// Nicht mehr verwendete Taxe ausblenden; sie wird ab sofort nicht mehr verrechnet.
export async function archiveRate(ctx: ApiContext, rateInput: unknown) {
  assertWrite(ctx);
  const rate = await rateById(ctx, rateInput);
  if (rate.archived_at) return;
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_billing_rates SET archived_at = NOW(), updated_at = NOW() WHERE id = ${rate.id}`,
    auditStatement(ctx, "billing_rate", String(rate.id), "archived", { name: rate.name }, null),
  ]);
}

export async function saveBillingSettings(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  if (typeof body.dischargeDayBilled !== "boolean")
    throw new ApiError("Bitte festlegen, ob der Austrittstag verrechnet wird.");
  const before = await loadSettings(ctx);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_billing_settings (organization_id, discharge_day_billed, updated_by)
      VALUES (${ctx.actor.organizationId}, ${body.dischargeDayBilled}, ${ctx.actor.id})
      ON CONFLICT (organization_id) DO UPDATE SET discharge_day_billed = EXCLUDED.discharge_day_billed,
        updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    auditStatement(ctx, "billing_settings", ctx.actor.organizationId, "updated", before, {
      dischargeDayBilled: body.dischargeDayBilled,
    }),
  ]);
}

// ---------------------------------------------------------------- Je Person

// Monatsberechnung für mehrere Personen (z. B. für den Rechnungslauf); ohne Regel zum Austrittstag: null.
export async function monthlyCalculations(
  ctx: ApiContext,
  month: string,
  residentIds: string[],
  rates: BillingRate[],
  settings: BillingSettings,
) {
  const result = new Map<string, BillingMonth>();
  if (settings.dischargeDayBilled === null || !residentIds.length) return result;
  const [stays, levels, absences, assigned] = (await Promise.all([
    ctx.sql`
      SELECT s.resident_id, to_char(s.started_at AT TIME ZONE o.timezone, 'YYYY-MM-DD') AS started,
        to_char(s.ended_at AT TIME ZONE o.timezone, 'YYYY-MM-DD') AS ended
      FROM carecore_resident_stays s
      JOIN carecore_residents r ON r.id = s.resident_id
      JOIN carecore_organizations o ON o.id = r.organization_id
      WHERE s.resident_id = ANY(${residentIds}) ORDER BY s.started_at`,
    ctx.sql`
      SELECT resident_id, care_level, to_char(valid_from, 'YYYY-MM-DD') AS day FROM carecore_resident_care_levels
      WHERE resident_id = ANY(${residentIds}) AND cancelled_at IS NULL`,
    ctx.sql`
      SELECT resident_id, kind, to_char(starts_on, 'YYYY-MM-DD') AS first_day, to_char(ends_on, 'YYYY-MM-DD') AS last_day
      FROM carecore_resident_absences WHERE resident_id = ANY(${residentIds}) AND cancelled_at IS NULL`,
    ctx.sql`
      SELECT resident_id, rate_id, to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
        to_char(valid_until, 'YYYY-MM-DD') AS valid_until
      FROM carecore_resident_rates WHERE resident_id = ANY(${residentIds}) AND cancelled_at IS NULL`,
  ])) as Row[][];
  const of = (rows: Row[], id: string) => rows.filter((row) => row.resident_id === id);
  for (const id of residentIds)
    result.set(
      id,
      computeMonth({
        month,
        stays: of(stays, id).map((row) => ({ from: String(row.started), until: day(row.ended) })),
        dischargeDayBilled: settings.dischargeDayBilled,
        rates,
        careLevels: of(levels, id).map((row) => ({ level: String(row.care_level), validFrom: String(row.day) })),
        absences: of(absences, id).map((row) => ({
          kind: row.kind as AbsenceKind,
          startsOn: String(row.first_day),
          endsOn: day(row.last_day),
        })),
        assigned: of(assigned, id).map((row) => ({
          rateId: String(row.rate_id),
          validFrom: String(row.valid_from),
          validUntil: day(row.valid_until),
        })),
      }),
    );
  return result;
}

export async function billingPerson(
  ctx: ApiContext,
  residentInput: unknown,
  monthInput: unknown,
): Promise<BillingPerson> {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const [country, rates, settings, current] = await Promise.all([
    organizationCountry(ctx),
    loadRates(ctx),
    loadSettings(ctx),
    today(ctx),
  ]);
  const month = typeof monthInput === "string" && MONTH.test(monthInput) ? monthInput : current.slice(0, 7);
  const [people, levels, absences, assigned, plans, addresses, calculations] = (await Promise.all([
    ctx.sql`
      SELECT r.last_name || ' ' || r.first_name AS name, to_char(r.admitted_on, 'YYYY-MM-DD') AS admitted_on,
        COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS unit
      FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id
        ORDER BY (ended_at IS NULL) DESC, started_at DESC LIMIT 1) st ON TRUE
      LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
      LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id
      WHERE r.id = ${residentId}`,
    ctx.sql`
      SELECT l.*, to_char(l.valid_from, 'YYYY-MM-DD') AS day, COALESCE(u.display_name, 'Unbekannt') AS author
      FROM carecore_resident_care_levels l LEFT JOIN carecore_users u ON u.id = l.created_by
      WHERE l.resident_id = ${residentId} AND l.cancelled_at IS NULL ORDER BY l.valid_from DESC`,
    ctx.sql`
      SELECT a.*, to_char(a.starts_on, 'YYYY-MM-DD') AS first_day, to_char(a.ends_on, 'YYYY-MM-DD') AS last_day,
        COALESCE(u.display_name, 'Unbekannt') AS author
      FROM carecore_resident_absences a LEFT JOIN carecore_users u ON u.id = a.created_by
      WHERE a.resident_id = ${residentId} AND a.cancelled_at IS NULL ORDER BY a.starts_on DESC`,
    ctx.sql`
      SELECT a.id, a.rate_id, r.name, to_char(a.valid_from, 'YYYY-MM-DD') AS valid_from,
        to_char(a.valid_until, 'YYYY-MM-DD') AS valid_until
      FROM carecore_resident_rates a JOIN carecore_billing_rates r ON r.id = a.rate_id
      WHERE a.resident_id = ${residentId} AND a.cancelled_at IS NULL ORDER BY a.valid_from DESC`,
    ctx.sql`
      SELECT care_level FROM carecore_care_plans WHERE resident_id = ${residentId}
        AND status IN ('draft', 'active', 'review') ORDER BY updated_at DESC LIMIT 1`,
    ctx.sql`SELECT * FROM carecore_resident_billing_addresses WHERE resident_id = ${residentId}`,
    monthlyCalculations(ctx, month, [residentId], rates, settings),
  ])) as [Row[], Row[], Row[], Row[], Row[], Row[], Map<string, BillingMonth>];
  const address = addresses[0];
  const person = people[0];
  const careLevels = levels.map((row) => ({
    id: String(row.id),
    level: String(row.care_level),
    validFrom: String(row.day),
    note: String(row.note),
    author: String(row.author),
    createdAt: iso(row.created_at) ?? "",
  }));
  const absenceList = absences.map((row) => ({
    id: String(row.id),
    kind: row.kind as AbsenceKind,
    startsOn: String(row.first_day),
    endsOn: day(row.last_day),
    note: String(row.note),
    author: String(row.author),
  }));
  const assignedList = assigned.map((row) => ({
    id: String(row.id),
    rateId: String(row.rate_id),
    name: String(row.name),
    validFrom: String(row.valid_from),
    validUntil: day(row.valid_until),
  }));
  return {
    residentId,
    resident: {
      name: String(person?.name ?? ""),
      room: String(person?.room ?? ""),
      unit: String(person?.unit ?? ""),
      admittedOn: day(person?.admitted_on),
    },
    currency: currencyOf(country),
    today: current,
    careLevels,
    planCareLevel: (plans[0]?.care_level as string | null) ?? null,
    absences: absenceList,
    assigned: assignedList,
    previewMonth: month,
    preview: calculations.get(residentId) ?? null,
    address: address
      ? {
          name: String(address.name),
          addition: String(address.addition),
          street: String(address.street),
          building: String(address.building),
          zip: String(address.zip),
          city: String(address.city),
          country: String(address.country),
        }
      : null,
    settings,
  };
}

const conflict = (error: unknown, code: string, message: string) => {
  if (String(error).includes(code)) throw new ApiError(message, 409);
  throw error;
};

// Pflegestufe ab einem Datum ({ residentId, level, validFrom, note }).
export async function addCareLevel(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const level = await assertLevel(ctx, body.level);
  const validFrom = date(body.validFrom, "Das Datum „gültig ab“");
  const note = text(body.note, 500);
  const id = randomUUID();
  await ctx.sql
    .transaction([
      ctx.sql`
        INSERT INTO carecore_resident_care_levels (id, organization_id, resident_id, care_level, valid_from, note, created_by)
        VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${level}, ${validFrom}, ${note}, ${ctx.actor.id})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "care_level",
        entityId: id,
        action: "created",
        after: { level, validFrom, note },
      }),
    ])
    .catch((error) =>
      conflict(error, "carecore_resident_care_levels_day_idx", "Ab diesem Datum ist bereits eine Stufe erfasst."),
    );
  return { id };
}

async function personRow(ctx: ApiContext, table: "levels" | "absences" | "rates", input: unknown) {
  const id = assertUuid(input, "Eintrag");
  const rows = (await (table === "levels"
    ? ctx.sql`SELECT * FROM carecore_resident_care_levels WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`
    : table === "absences"
      ? ctx.sql`SELECT *, to_char(starts_on, 'YYYY-MM-DD') AS first_day, to_char(ends_on, 'YYYY-MM-DD') AS last_day
          FROM carecore_resident_absences WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`
      : ctx.sql`SELECT *, to_char(valid_from, 'YYYY-MM-DD') AS from_day, to_char(valid_until, 'YYYY-MM-DD') AS until_day
          FROM carecore_resident_rates WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`)) as Row[];
  if (!rows[0]) throw new ApiError("Eintrag nicht gefunden.", 404);
  if (rows[0].cancelled_at) throw new ApiError("Der Eintrag ist bereits storniert.", 409);
  return rows[0];
}

// Stornieren mit Grund (Pflegestufe, Abwesenheit oder zugewiesene Taxe); der Eintrag bleibt im Protokoll.
export async function cancelBillingEntry(
  ctx: ApiContext,
  table: "levels" | "absences" | "rates",
  input: unknown,
  body: Record<string, unknown>,
) {
  assertWrite(ctx);
  const row = await personRow(ctx, table, input);
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  const entityType = table === "levels" ? "care_level" : table === "absences" ? "resident_absence" : "resident_rate";
  await ctx.sql.transaction([
    table === "levels"
      ? ctx.sql`UPDATE carecore_resident_care_levels SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id},
          cancel_reason = ${reason} WHERE id = ${row.id} AND cancelled_at IS NULL`
      : table === "absences"
        ? ctx.sql`UPDATE carecore_resident_absences SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id},
            cancel_reason = ${reason}, updated_at = NOW() WHERE id = ${row.id} AND cancelled_at IS NULL`
        : ctx.sql`UPDATE carecore_resident_rates SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id},
            cancel_reason = ${reason}, updated_at = NOW() WHERE id = ${row.id} AND cancelled_at IS NULL`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId: String(row.resident_id),
      entityType,
      entityId: String(row.id),
      action: "cancelled",
      after: { reason },
    }),
  ]);
}

function absenceFields(body: Record<string, unknown>) {
  const kind = String(body.kind ?? "") as AbsenceKind;
  if (!(kind in ABSENCE_KINDS)) throw new ApiError("Bitte die Art der Abwesenheit wählen.");
  const startsOn = date(body.startsOn, "Der erste Tag");
  const endsOn = optionalDate(body.endsOn, "Der letzte Tag");
  if (endsOn && endsOn < startsOn) throw new ApiError("Der letzte Tag liegt vor dem ersten.");
  return { kind, startsOn, endsOn, note: text(body.note, 500) };
}

async function assertNoOverlap(
  ctx: ApiContext,
  residentId: string,
  fields: { startsOn: string; endsOn: string | null },
  except: string | null,
) {
  const [overlap] = (await ctx.sql`
    SELECT id FROM carecore_resident_absences WHERE resident_id = ${residentId} AND cancelled_at IS NULL
      AND (${except}::uuid IS NULL OR id <> ${except}::uuid)
      AND starts_on <= COALESCE(${fields.endsOn}::date, 'infinity'::date)
      AND COALESCE(ends_on, 'infinity'::date) >= ${fields.startsOn}::date`) as Row[];
  if (overlap) throw new ApiError("Die Abwesenheit überschneidet sich mit einer bereits erfassten.", 409);
}

// Abwesenheit ({ residentId, kind, startsOn, endsOn?, note }): erster und letzter ganzer Tag ausser Haus.
export async function addAbsence(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const fields = absenceFields(body);
  await assertNoOverlap(ctx, residentId, fields, null);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_resident_absences (id, organization_id, resident_id, kind, starts_on, ends_on, note, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${fields.kind}, ${fields.startsOn}, ${fields.endsOn},
        ${fields.note}, ${ctx.actor.id})`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident_absence",
      entityId: id,
      action: "created",
      after: fields,
    }),
  ]);
  return { id };
}

// Abwesenheit anpassen, z. B. den letzten Tag nach der Rückkehr eintragen.
export async function updateAbsence(ctx: ApiContext, input: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await personRow(ctx, "absences", input);
  const residentId = String(before.resident_id);
  const fields = absenceFields(body);
  await assertNoOverlap(ctx, residentId, fields, String(before.id));
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_resident_absences SET kind = ${fields.kind}, starts_on = ${fields.startsOn},
        ends_on = ${fields.endsOn}, note = ${fields.note}, updated_at = NOW()
      WHERE id = ${before.id} AND cancelled_at IS NULL`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident_absence",
      entityId: String(before.id),
      action: "updated",
      before: { kind: before.kind, startsOn: before.first_day, endsOn: before.last_day ?? null, note: before.note },
      after: fields,
    }),
  ]);
}

// Zusätzliche Taxe zuweisen ({ residentId, rateId, validFrom, validUntil? }).
export async function assignRate(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const rate = await rateById(ctx, body.rateId);
  if (rate.archived_at || rate.applies !== "assigned")
    throw new ApiError("Diese Taxe gilt für alle Personen oder wird nicht mehr verwendet.");
  const validFrom = date(body.validFrom, "Das Datum „ab“");
  const validUntil = optionalDate(body.validUntil, "Das Datum „bis“");
  if (validUntil && validUntil < validFrom) throw new ApiError("Das Datum „bis“ liegt vor „ab“.");
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_resident_rates (id, organization_id, resident_id, rate_id, valid_from, valid_until, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${rate.id}, ${validFrom}, ${validUntil}, ${ctx.actor.id})`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident_rate",
      entityId: id,
      action: "created",
      after: { name: rate.name, validFrom, validUntil },
    }),
  ]);
  return { id };
}

// Zugewiesene Taxe beenden ({ validUntil }).
export async function endAssignedRate(ctx: ApiContext, input: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await personRow(ctx, "rates", input);
  const validUntil = date(body.validUntil, "Das Datum „bis“");
  if (validUntil < String(before.from_day)) throw new ApiError("Das Datum „bis“ liegt vor „ab“.");
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_resident_rates SET valid_until = ${validUntil}, updated_at = NOW() WHERE id = ${before.id}`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId: String(before.resident_id),
      entityType: "resident_rate",
      entityId: String(before.id),
      action: "updated",
      before: { validUntil: before.until_day ?? null },
      after: { validUntil },
    }),
  ]);
}
