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
import { notifyStatements } from "@/lib/notify";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  ISOLATION_KINDS,
  ISOLATION_REVIEW_OUTCOMES,
  isolationLabel,
  type HygieneOverview,
  type IsolationKind,
  type IsolationMeasure,
  type IsolationReviewOutcome,
  type Outbreak,
} from "@/lib/hygiene-shared";

// Isolation und Ausbruch: organisatorische Übersicht. CareOS stellt keine Diagnose, schlägt keine Isolation vor und
// erklärt keinen Ausbruch anhand eigener Schwellen – Anlass, Anordnung und Ausbruch erfassen Fachpersonen bzw. die Leitung.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINK = "/c/bewohner/hygiene";

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

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "documentation.write")) throw new ApiError("Keine Berechtigung.", 403);
}

function assertManage(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "quality.manage"))
    throw new ApiError("Einen Ausbruch erfassen oder beenden kann nur die Leitung (Qualität).", 403);
}

async function today(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT (NOW() AT TIME ZONE timezone)::date::text AS today FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(rows[0]?.today);
}

// Meldung an die Leitung: alle mit Recht „Qualität verwalten“.
async function leaders(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT u.id FROM carecore_users u
    JOIN carecore_user_profiles p ON p.user_id = u.id
    JOIN carecore_roles r ON r.key = u.role
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active AND r.permissions ? 'quality.manage'`) as Row[];
  return rows.map((row) => String(row.id));
}

// Ausbruch: alle aktiven Mitarbeitenden des Wohnbereichs (bzw. des ganzen Hauses) und die Leitung.
async function outbreakRecipients(ctx: ApiContext, careUnitId: string | null) {
  const rows = (await ctx.sql`
    SELECT DISTINCT u.id FROM carecore_users u
    JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active
      AND (${careUnitId}::uuid IS NULL OR EXISTS (SELECT 1 FROM carecore_unit_memberships um
        WHERE um.user_id = u.id AND um.care_unit_id = ${careUnitId}::uuid))`) as Row[];
  return [...rows.map((row) => String(row.id)), ...(await leaders(ctx))];
}

async function assertCareUnit(ctx: ApiContext, value: unknown) {
  if (!value) return null;
  const id = assertUuid(value, "Wohnbereich");
  const rows = await ctx.sql`
    SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
    WHERE cu.id = ${id} AND s.organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  return id;
}

const measure = (row: Row, reviews: Row[]): IsolationMeasure => ({
  id: String(row.id),
  residentId: String(row.resident_id),
  residentName: String(row.resident_name),
  room: String(row.room ?? ""),
  careUnitId: (row.care_unit_id as string | null) ?? null,
  careUnit: String(row.care_unit ?? ""),
  outbreakId: (row.outbreak_id as string | null) ?? null,
  kind: (String(row.kind) in ISOLATION_KINDS ? row.kind : "other") as IsolationKind,
  reason: String(row.reason),
  precautions: String(row.precautions ?? ""),
  orderedBy: String(row.ordered_by),
  startsAt: iso(row.starts_at) ?? "",
  reviewOn: String(row.review_on),
  reviewDue: Boolean(row.review_due),
  endedAt: iso(row.ended_at),
  endNote: String(row.end_note ?? ""),
  createdBy: String(row.created_by_name ?? "Unbekannt"),
  reviews: reviews
    .filter((review) => review.measure_id === row.id)
    .map((review) => ({
      id: String(review.id),
      reviewedAt: iso(review.reviewed_at) ?? "",
      reviewedBy: String(review.reviewed_by_name ?? "Unbekannt"),
      outcome: review.outcome as IsolationReviewOutcome,
      note: String(review.note),
      nextReviewOn: (review.next_review_on as string | null) ?? null,
    })),
});

const outbreak = (row: Row): Outbreak => ({
  id: String(row.id),
  careUnitId: (row.care_unit_id as string | null) ?? null,
  careUnit: (row.care_unit as string | null) ?? null,
  title: String(row.title),
  measures: String(row.measures ?? ""),
  declaredAt: iso(row.declared_at) ?? "",
  declaredBy: String(row.declared_by_name ?? "Unbekannt"),
  authorityReportedOn: (row.authority_reported_on as string | null) ?? null,
  authorityNote: String(row.authority_note ?? ""),
  endedAt: iso(row.ended_at),
  endNote: String(row.end_note ?? ""),
  activeIsolations: Number(row.active_isolations ?? 0),
});

export async function hygieneOverview(ctx: ApiContext, careUnitInput: string | null): Promise<HygieneOverview> {
  const careUnitId = careUnitInput ? assertUuid(careUnitInput, "Wohnbereich") : null;
  const org = ctx.actor.organizationId;
  const [measures, outbreaks] = (await Promise.all([
    // Laufende Isolationen und in den letzten 90 Tagen aufgehobene; Wohnbereich und Zimmer aktuell.
    ctx.sql`
      SELECT m.id, m.resident_id, m.outbreak_id, m.kind, m.reason, m.precautions, m.ordered_by, m.starts_at,
        m.review_on::text AS review_on, m.ended_at, m.end_note,
        (m.ended_at IS NULL AND m.review_on <= (NOW() AT TIME ZONE o.timezone)::date) AS review_due,
        r.first_name || ' ' || r.last_name AS resident_name, COALESCE(ro.name, '') AS room,
        COALESCE(stay.care_unit_id, m.care_unit_id) AS care_unit_id, COALESCE(cu.name, '') AS care_unit,
        COALESCE(u.display_name, 'Unbekannt') AS created_by_name
      FROM carecore_isolation_measures m
      JOIN carecore_organizations o ON o.id = m.organization_id
      JOIN carecore_residents r ON r.id = m.resident_id
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id
        AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      LEFT JOIN carecore_care_units cu ON cu.id = COALESCE(stay.care_unit_id, m.care_unit_id)
      LEFT JOIN carecore_users u ON u.id = m.created_by
      WHERE m.organization_id = ${org}
        AND (m.ended_at IS NULL OR m.ended_at > NOW() - INTERVAL '90 days')
        AND (${careUnitId}::uuid IS NULL OR COALESCE(stay.care_unit_id, m.care_unit_id) = ${careUnitId}::uuid)
      ORDER BY m.ended_at DESC NULLS FIRST, cu.name, ro.name NULLS LAST, r.last_name`,
    ctx.sql`
      SELECT b.*, b.authority_reported_on::text AS authority_reported_on, cu.name AS care_unit,
        COALESCE(u.display_name, 'Unbekannt') AS declared_by_name,
        (SELECT COUNT(*)::int FROM carecore_isolation_measures m WHERE m.outbreak_id = b.id AND m.ended_at IS NULL)
          AS active_isolations
      FROM carecore_outbreaks b
      LEFT JOIN carecore_care_units cu ON cu.id = b.care_unit_id
      LEFT JOIN carecore_users u ON u.id = b.declared_by
      WHERE b.organization_id = ${org}
        AND (b.ended_at IS NULL OR b.ended_at > NOW() - INTERVAL '90 days')
        AND (${careUnitId}::uuid IS NULL OR b.care_unit_id IS NULL OR b.care_unit_id = ${careUnitId}::uuid)
      ORDER BY b.ended_at DESC NULLS FIRST, b.declared_at DESC`,
  ])) as Row[][];
  const ids = measures.map((row) => String(row.id));
  const reviews = ids.length
    ? ((await ctx.sql`
        SELECT v.*, v.next_review_on::text AS next_review_on, COALESCE(u.display_name, 'Unbekannt') AS reviewed_by_name
        FROM carecore_isolation_reviews v LEFT JOIN carecore_users u ON u.id = v.reviewed_by
        WHERE v.measure_id = ANY(${ids}::uuid[]) ORDER BY v.reviewed_at`) as Row[])
    : [];
  const list = measures.map((row) => measure(row, reviews));
  const breaks = outbreaks.map(outbreak);
  return {
    careUnitId,
    today: await today(ctx),
    canWrite: hasPermission(ctx.actor, "documentation.write"),
    canManage: hasPermission(ctx.actor, "quality.manage"),
    active: list.filter((item) => !item.endedAt),
    ended: list.filter((item) => item.endedAt),
    outbreaks: breaks.filter((item) => !item.endedAt),
    endedOutbreaks: breaks.filter((item) => item.endedAt),
  };
}

// Laufende Isolationen für Tagesliste und Überleitungsbogen.
export async function activeIsolations(ctx: ApiContext, residentId: string | null = null) {
  return (await ctx.sql`
    SELECT m.id, m.resident_id, m.kind, m.reason, m.precautions, m.starts_at,
      (m.review_on <= (NOW() AT TIME ZONE o.timezone)::date) AS review_due
    FROM carecore_isolation_measures m JOIN carecore_organizations o ON o.id = m.organization_id
    WHERE m.organization_id = ${ctx.actor.organizationId} AND m.ended_at IS NULL
      AND (${residentId}::uuid IS NULL OR m.resident_id = ${residentId}::uuid)
    ORDER BY m.starts_at`) as Row[];
}

async function assertOutbreak(ctx: ApiContext, value: unknown) {
  if (!value) return null;
  const id = assertUuid(value, "Ausbruch");
  const rows = await ctx.sql`
    SELECT id FROM carecore_outbreaks WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}
      AND ended_at IS NULL`;
  if (!rows[0]) throw new ApiError("Laufender Ausbruch nicht gefunden.", 404);
  return id;
}

export async function createIsolation(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const kind = String(body.kind ?? "") as IsolationKind;
  if (!(kind in ISOLATION_KINDS)) throw new ApiError("Bitte die Art der Isolation wählen.");
  const reason = required(body.reason, "Anlass laut Anordnung", 2000);
  const orderedBy = required(body.orderedBy, "Angeordnet von", 160);
  const precautions = text(body.precautions, 2000);
  const startsAt = typeof body.startsAt === "string" && body.startsAt ? new Date(body.startsAt) : new Date();
  if (Number.isNaN(startsAt.getTime())) throw new ApiError("Beginn ist ungültig.");
  if (startsAt.getTime() > Date.now() + 5 * 60_000) throw new ApiError("Der Beginn liegt in der Zukunft.");
  const reviewOn = date(body.reviewOn, "Nächste Überprüfung", true);
  if (reviewOn < (await today(ctx))) throw new ApiError("Die nächste Überprüfung liegt in der Vergangenheit.");
  const outbreakId = await assertOutbreak(ctx, body.outbreakId);
  const resident = (
    (await ctx.sql`
      SELECT r.first_name || ' ' || r.last_name AS name,
        (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
          ORDER BY started_at DESC LIMIT 1) AS care_unit_id
      FROM carecore_residents r WHERE r.id = ${residentId}`) as Row[]
  )[0];
  const id = randomUUID();
  const input = { kind, reason, precautions, orderedBy, startsAt: startsAt.toISOString(), reviewOn, outbreakId };
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_isolation_measures (id, organization_id, resident_id, care_unit_id, outbreak_id, kind, reason,
        precautions, ordered_by, starts_at, review_on, created_by, updated_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${(resident?.care_unit_id as string | null) ?? null},
        ${outbreakId}, ${kind}, ${reason}, ${precautions}, ${orderedBy}, ${input.startsAt}, ${reviewOn}::date,
        ${ctx.actor.id}, ${ctx.actor.id})`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "isolation_measure",
      entityId: id,
      action: "created",
      after: input,
    }),
    ...notifyStatements(
      ctx,
      await leaders(ctx),
      `${isolationLabel(kind)}: ${String(resident?.name ?? "")}`,
      `Anlass: ${reason.slice(0, 160)}`,
      "isolation",
      LINK,
    ),
  ]);
  return { id };
}

// Überprüfung: weiterführen (mit nächstem Termin) oder aufheben. Gleichzeitig aufgehoben: alles wird zurückgerollt.
export async function reviewIsolation(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const id = assertUuid(idInput, "Isolation");
  const rows = (await ctx.sql`
    SELECT m.id, m.resident_id, m.kind, m.review_on::text AS review_on, m.ended_at,
      r.first_name || ' ' || r.last_name AS resident_name
    FROM carecore_isolation_measures m JOIN carecore_residents r ON r.id = m.resident_id
    WHERE m.id = ${id} AND m.organization_id = ${ctx.actor.organizationId}`) as Row[];
  const before = rows[0];
  if (!before) throw new ApiError("Isolation nicht gefunden.", 404);
  if (before.ended_at) throw new ApiError("Die Isolation ist bereits aufgehoben.", 409);
  const outcome = String(body.outcome ?? "") as IsolationReviewOutcome;
  if (!(outcome in ISOLATION_REVIEW_OUTCOMES)) throw new ApiError("Bitte wählen: weiterführen oder aufheben.");
  const note = required(body.note, outcome === "end" ? "Grund für das Aufheben" : "Ergebnis der Überprüfung", 2000);
  const nextReviewOn = outcome === "continue" ? date(body.nextReviewOn, "Nächste Überprüfung", true) : null;
  if (nextReviewOn && nextReviewOn < (await today(ctx)))
    throw new ApiError("Die nächste Überprüfung liegt in der Vergangenheit.");
  const residentId = String(before.resident_id);
  const reviewId = randomUUID();
  try {
    await ctx.sql.transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_isolation_measures SET
          review_on = COALESCE(${nextReviewOn}::date, review_on),
          ended_at = CASE WHEN ${outcome} = 'end' THEN GREATEST(NOW(), starts_at) ELSE NULL END,
          ended_by = CASE WHEN ${outcome} = 'end' THEN ${ctx.actor.id}::uuid ELSE NULL END,
          end_note = CASE WHEN ${outcome} = 'end' THEN ${note} ELSE '' END,
          updated_by = ${ctx.actor.id}, updated_at = NOW()
        WHERE id = ${id} AND ended_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'ISOLATION_ENDED')`,
      ctx.sql`
        INSERT INTO carecore_isolation_reviews (id, measure_id, reviewed_by, outcome, note, next_review_on)
        VALUES (${reviewId}, ${id}, ${ctx.actor.id}, ${outcome}, ${note}, ${nextReviewOn}::date)`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "isolation_measure",
        entityId: id,
        action: outcome === "end" ? "ended" : "reviewed",
        before: { reviewOn: before.review_on },
        after: { outcome, note, reviewOn: nextReviewOn },
      }),
      ...(outcome === "end"
        ? notifyStatements(
            ctx,
            await leaders(ctx),
            `Isolation aufgehoben: ${String(before.resident_name)}`,
            note.slice(0, 180),
            "isolation",
            LINK,
          )
        : []),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("ISOLATION_ENDED"))
      throw new ApiError("Die Isolation ist bereits aufgehoben.", 409);
    throw error;
  }
  return { id: reviewId };
}

function outbreakInput(body: Record<string, unknown>) {
  return {
    measures: text(body.measures, 4000),
    authorityReportedOn: date(body.authorityReportedOn, "Meldung an die Behörde", false),
    authorityNote: text(body.authorityNote, 400),
  };
}

// Ausbruch erklären: nur die Leitung; informiert die Mitarbeitenden des Wohnbereichs bzw. des Hauses.
export async function declareOutbreak(ctx: ApiContext, body: Record<string, unknown>) {
  assertManage(ctx);
  const title = required(body.title, "Bezeichnung", 160);
  const careUnitId = await assertCareUnit(ctx, body.careUnitId);
  const input = outbreakInput(body);
  const id = randomUUID();
  const where = careUnitId
    ? String(((await ctx.sql`SELECT name FROM carecore_care_units WHERE id = ${careUnitId}`) as Row[])[0]?.name ?? "")
    : "ganzes Haus";
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_outbreaks (id, organization_id, care_unit_id, title, measures, declared_by,
        authority_reported_on, authority_note)
      VALUES (${id}, ${ctx.actor.organizationId}, ${careUnitId}, ${title}, ${input.measures}, ${ctx.actor.id},
        ${input.authorityReportedOn}::date, ${input.authorityNote})`,
    auditStatement(ctx, "outbreak", id, "declared", null, { title, careUnitId, ...input }),
    ...notifyStatements(
      ctx,
      await outbreakRecipients(ctx, careUnitId),
      `Ausbruch: ${title} (${where})`,
      input.measures ? input.measures.slice(0, 180) : "Bitte die Hygienemassnahmen der Einrichtung beachten.",
      "outbreak",
      LINK,
      "high",
    ),
  ]);
  return { id };
}

async function activeOutbreak(ctx: ApiContext, idInput: unknown) {
  assertManage(ctx);
  const id = assertUuid(idInput, "Ausbruch");
  const rows = (await ctx.sql`
    SELECT *, authority_reported_on::text AS authority_reported_on FROM carecore_outbreaks
    WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  const row = rows[0];
  if (!row) throw new ApiError("Ausbruch nicht gefunden.", 404);
  if (row.ended_at) throw new ApiError("Der Ausbruch ist bereits beendet.", 409);
  return row;
}

async function stillActive(write: Promise<unknown>) {
  try {
    await write;
  } catch (error) {
    if (error instanceof Error && error.message.includes("OUTBREAK_ENDED"))
      throw new ApiError("Der Ausbruch ist bereits beendet.", 409);
    throw error;
  }
}

// Massnahmen und Meldung an die Behörde nachtragen.
export async function updateOutbreak(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  const before = await activeOutbreak(ctx, idInput);
  const input = outbreakInput(body);
  await stillActive(
    ctx.sql.transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_outbreaks SET measures = ${input.measures},
          authority_reported_on = ${input.authorityReportedOn}::date, authority_note = ${input.authorityNote}
        WHERE id = ${before.id} AND ended_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'OUTBREAK_ENDED')`,
      auditStatement(
        ctx,
        "outbreak",
        String(before.id),
        "updated",
        {
          measures: before.measures,
          authorityReportedOn: before.authority_reported_on,
          authorityNote: before.authority_note,
        },
        input,
      ),
    ]),
  );
}

export async function endOutbreak(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  const before = await activeOutbreak(ctx, idInput);
  const note = required(body.note, "Abschluss", 2000);
  const careUnitId = (before.care_unit_id as string | null) ?? null;
  await stillActive(
    ctx.sql.transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_outbreaks SET ended_at = NOW(), ended_by = ${ctx.actor.id}, end_note = ${note}
        WHERE id = ${before.id} AND ended_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'OUTBREAK_ENDED')`,
      auditStatement(
        ctx,
        "outbreak",
        String(before.id),
        "ended",
        { title: before.title },
        { title: before.title, note },
      ),
      ...notifyStatements(
        ctx,
        await outbreakRecipients(ctx, careUnitId),
        `Ausbruch beendet: ${String(before.title)}`,
        note.slice(0, 180),
        "outbreak",
        LINK,
      ),
    ]),
  );
}
