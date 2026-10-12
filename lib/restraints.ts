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
import { hasPermission } from "@/lib/server-data";
import {
  RESTRAINT_CONSENT,
  RESTRAINT_KINDS,
  RESTRAINT_REVIEW_OUTCOMES,
  type RestraintConsent,
  type RestraintKind,
  type RestraintMeasure,
  type RestraintReviewOutcome,
} from "@/lib/restraints-shared";

// Freiheitsbeschränkende Massnahmen: erfassen, korrigieren, überprüfen (weiterführen oder beenden). Jede Änderung
// steht im Änderungsprotokoll; Massnahmen werden nie gelöscht.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function date(value: unknown, label: string, required: true): string;
function date(value: unknown, label: string, required: false): string | null;
function date(value: unknown, label: string, required: boolean) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new ApiError(`${label} fehlt.`);
    return null;
  }
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new ApiError(`${label} ist ungültig.`);
  return value;
}

function required(value: unknown, label: string, max: number) {
  const result = text(value, max);
  if (!result) throw new ApiError(`${label} fehlt.`);
  return result;
}

const day = (value: unknown) => (value ? (iso(value) ?? "").slice(0, 10) : null);

function measureInput(body: Record<string, unknown>) {
  const kind = String(body.kind ?? "") as RestraintKind;
  if (!(kind in RESTRAINT_KINDS)) throw new ApiError("Bitte die Art der Massnahme wählen.");
  const consent = String(body.residentConsent ?? "") as RestraintConsent;
  if (!(consent in RESTRAINT_CONSENT)) throw new ApiError("Bitte festhalten, ob die Person zustimmt.");
  const description = text(body.description, 2000);
  if (kind === "other" && !description) throw new ApiError("Bitte die Massnahme beschreiben.");
  const startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : new Date(NaN);
  if (Number.isNaN(startsAt.getTime())) throw new ApiError("Beginn ist ungültig.");
  const reviewOn = date(body.reviewOn, "Nächste Überprüfung", true);
  const plannedUntil = date(body.plannedUntil, "Geplantes Ende", false);
  const startDay = startsAt.toISOString().slice(0, 10);
  if (reviewOn < startDay) throw new ApiError("Die nächste Überprüfung liegt vor dem Beginn.");
  if (plannedUntil && plannedUntil < startDay) throw new ApiError("Das geplante Ende liegt vor dem Beginn.");
  const representativeInformedOn = date(body.representativeInformedOn, "Datum der Information", false);
  return {
    kind,
    description,
    reason: required(body.reason, "Grund und Zweck", 4000),
    alternatives: required(body.alternatives, "Geprüfte mildere Massnahmen", 4000),
    schedule: text(body.schedule, 500),
    orderedBy: required(body.orderedBy, "Anordnende Person", 160),
    residentConsent: consent,
    residentInformed: body.residentInformed === true,
    representativeName: text(body.representativeName, 160),
    representativeInformedOn,
    approvalReference: text(body.approvalReference, 240),
    startsAt: startsAt.toISOString(),
    plannedUntil,
    reviewOn,
  };
}

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "residents.write")) throw new ApiError("Keine Berechtigung.", 403);
}

export async function listRestraints(ctx: ApiContext, residentIdInput: unknown): Promise<RestraintMeasure[]> {
  const residentId = await assertResident(ctx, residentIdInput);
  const [measures, reviews] = (await Promise.all([
    ctx.sql`
      SELECT m.*, COALESCE(u.display_name, 'System') AS created_by_name,
        (m.ended_at IS NULL AND m.review_on <= (NOW() AT TIME ZONE o.timezone)::date) AS review_due
      FROM carecore_restraint_measures m
      JOIN carecore_organizations o ON o.id = m.organization_id
      LEFT JOIN carecore_users u ON u.id = m.created_by
      WHERE m.resident_id = ${residentId} AND m.organization_id = ${ctx.actor.organizationId}
      ORDER BY (m.ended_at IS NULL) DESC, m.starts_at DESC`,
    ctx.sql`
      SELECT rv.*, COALESCE(u.display_name, 'System') AS reviewed_by_name
      FROM carecore_restraint_reviews rv
      JOIN carecore_restraint_measures m ON m.id = rv.measure_id
      LEFT JOIN carecore_users u ON u.id = rv.reviewed_by
      WHERE m.resident_id = ${residentId} AND m.organization_id = ${ctx.actor.organizationId}
      ORDER BY rv.reviewed_at DESC`,
  ])) as Row[][];
  return measures.map((row) => ({
    id: String(row.id),
    residentId,
    kind: row.kind as RestraintKind,
    description: String(row.description),
    reason: String(row.reason),
    alternatives: String(row.alternatives),
    schedule: String(row.schedule),
    orderedBy: String(row.ordered_by),
    residentConsent: row.resident_consent as RestraintConsent,
    residentInformed: Boolean(row.resident_informed),
    representativeName: String(row.representative_name),
    representativeInformedOn: day(row.representative_informed_on),
    approvalReference: String(row.approval_reference),
    startsAt: iso(row.starts_at) ?? "",
    plannedUntil: day(row.planned_until),
    reviewOn: day(row.review_on) ?? "",
    endedAt: iso(row.ended_at),
    endReason: String(row.end_reason),
    createdBy: String(row.created_by_name),
    reviewDue: Boolean(row.review_due),
    reviews: reviews
      .filter((review) => review.measure_id === row.id)
      .map((review) => ({
        id: String(review.id),
        reviewedAt: iso(review.reviewed_at) ?? "",
        reviewedBy: String(review.reviewed_by_name),
        outcome: review.outcome as RestraintReviewOutcome,
        note: String(review.note),
        nextReviewOn: day(review.next_review_on),
      })),
  }));
}

// Spalten für das Protokoll (gleiche Schlüssel wie die Eingabe, damit Vorher und Nachher vergleichbar sind).
const snapshot = (row: Row) => ({
  kind: row.kind,
  description: row.description,
  reason: row.reason,
  alternatives: row.alternatives,
  schedule: row.schedule,
  orderedBy: row.ordered_by,
  residentConsent: row.resident_consent,
  residentInformed: row.resident_informed,
  representativeName: row.representative_name,
  representativeInformedOn: day(row.representative_informed_on),
  approvalReference: row.approval_reference,
  startsAt: iso(row.starts_at),
  plannedUntil: day(row.planned_until),
  reviewOn: day(row.review_on),
  residentId: row.resident_id,
});

export async function createRestraint(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const input = measureInput(body);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_restraint_measures (id, organization_id, resident_id, kind, description, reason, alternatives,
        schedule, ordered_by, resident_consent, resident_informed, representative_name, representative_informed_on,
        approval_reference, starts_at, planned_until, review_on, created_by, updated_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${input.kind}, ${input.description}, ${input.reason},
        ${input.alternatives}, ${input.schedule}, ${input.orderedBy}, ${input.residentConsent}, ${input.residentInformed},
        ${input.representativeName}, ${input.representativeInformedOn}::date, ${input.approvalReference},
        ${input.startsAt}::timestamptz, ${input.plannedUntil}::date, ${input.reviewOn}::date, ${ctx.actor.id}, ${ctx.actor.id})`,
    auditStatement(ctx, "restraint_measure", id, "created", null, { ...input, residentId }),
  ]);
  return { id };
}

async function activeMeasure(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Massnahme");
  const rows = (await ctx.sql`
    SELECT * FROM carecore_restraint_measures WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  const row = rows[0];
  if (!row) throw new ApiError("Massnahme nicht gefunden.", 404);
  if (row.ended_at) throw new ApiError("Die Massnahme ist bereits beendet.", 409);
  return row;
}

// Gleichzeitig beendet: die ganze Änderung wird zurückgerollt (carecore_assert in derselben Transaktion).
async function stillActive(write: Promise<unknown>) {
  try {
    await write;
  } catch (error) {
    if (error instanceof Error && error.message.includes("RESTRAINT_ENDED"))
      throw new ApiError("Die Massnahme ist bereits beendet.", 409);
    throw error;
  }
}

export async function updateRestraint(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await activeMeasure(ctx, idInput);
  const input = measureInput(body);
  await stillActive(
    ctx.sql.transaction([
      ctx.sql`
      WITH changed AS (UPDATE carecore_restraint_measures SET kind = ${input.kind}, description = ${input.description},
        reason = ${input.reason}, alternatives = ${input.alternatives}, schedule = ${input.schedule},
        ordered_by = ${input.orderedBy}, resident_consent = ${input.residentConsent},
        resident_informed = ${input.residentInformed}, representative_name = ${input.representativeName},
        representative_informed_on = ${input.representativeInformedOn}::date,
        approval_reference = ${input.approvalReference}, starts_at = ${input.startsAt}::timestamptz,
        planned_until = ${input.plannedUntil}::date, review_on = ${input.reviewOn}::date,
        updated_by = ${ctx.actor.id}, updated_at = NOW()
      WHERE id = ${before.id} AND ended_at IS NULL RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'RESTRAINT_ENDED')`,
      auditStatement(ctx, "restraint_measure", String(before.id), "updated", snapshot(before), {
        ...input,
        residentId: before.resident_id,
      }),
    ]),
  );
}

// Überprüfung: weiterführen (mit nächstem Termin) oder beenden. Die Notiz hält die Begründung fest.
export async function reviewRestraint(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await activeMeasure(ctx, idInput);
  const outcome = String(body.outcome ?? "") as RestraintReviewOutcome;
  if (!(outcome in RESTRAINT_REVIEW_OUTCOMES)) throw new ApiError("Bitte wählen: weiterführen oder beenden.");
  const note = required(body.note, outcome === "end" ? "Grund für das Beenden" : "Ergebnis der Überprüfung", 4000);
  const nextReviewOn = outcome === "continue" ? date(body.nextReviewOn, "Nächste Überprüfung", true) : null;
  const today = (
    (await ctx.sql`SELECT (NOW() AT TIME ZONE timezone)::date::text AS today FROM carecore_organizations
      WHERE id = ${ctx.actor.organizationId}`) as Row[]
  )[0]?.today as string;
  if (nextReviewOn && nextReviewOn < today) throw new ApiError("Die nächste Überprüfung liegt in der Vergangenheit.");
  const reviewId = randomUUID();
  await stillActive(
    ctx.sql.transaction([
      ctx.sql`
      WITH changed AS (UPDATE carecore_restraint_measures SET
        review_on = COALESCE(${nextReviewOn}::date, review_on),
        ended_at = CASE WHEN ${outcome} = 'end' THEN GREATEST(NOW(), starts_at) ELSE NULL END,
        end_reason = CASE WHEN ${outcome} = 'end' THEN ${note} ELSE '' END,
        ended_by = CASE WHEN ${outcome} = 'end' THEN ${ctx.actor.id}::uuid ELSE NULL END,
        updated_by = ${ctx.actor.id}, updated_at = NOW()
      WHERE id = ${before.id} AND ended_at IS NULL RETURNING id)
      SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'RESTRAINT_ENDED')`,
      ctx.sql`
      INSERT INTO carecore_restraint_reviews (id, measure_id, reviewed_by, outcome, note, next_review_on)
      VALUES (${reviewId}, ${before.id}, ${ctx.actor.id}, ${outcome}, ${note}, ${nextReviewOn}::date)`,
      auditStatement(
        ctx,
        "restraint_measure",
        String(before.id),
        outcome === "end" ? "ended" : "reviewed",
        { reviewOn: day(before.review_on), residentId: before.resident_id },
        { outcome, note, reviewOn: nextReviewOn, residentId: before.resident_id },
      ),
    ]),
  );
  return { id: reviewId };
}

// Laufende Massnahmen einer Einrichtung für Tagesliste und Überleitungsbogen.
export async function activeRestraints(ctx: ApiContext, residentId: string | null = null) {
  return (await ctx.sql`
    SELECT m.id, m.resident_id, m.kind, m.description, m.schedule, m.starts_at, m.review_on,
      (m.review_on <= (NOW() AT TIME ZONE o.timezone)::date) AS review_due,
      (m.representative_informed_on IS NULL) AS representative_pending
    FROM carecore_restraint_measures m JOIN carecore_organizations o ON o.id = m.organization_id
    WHERE m.organization_id = ${ctx.actor.organizationId} AND m.ended_at IS NULL
      AND (${residentId}::uuid IS NULL OR m.resident_id = ${residentId}::uuid)
    ORDER BY m.review_on`) as Row[];
}
