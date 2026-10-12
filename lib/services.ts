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
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  MAX_SERVICE_MINUTES,
  SERVICE_CATEGORIES,
  parseMonth,
  type ServiceCatalogItem,
  type ServiceDay,
  type ServiceRecord,
  type ServiceReport,
  type ServiceReportResident,
  type ServiceSource,
  type ServiceSuggestion,
} from "@/lib/services-shared";

// Leistungserfassung: erbrachte Pflegeleistungen mit Zeit. Der Katalog gehört der Einrichtung; CareOS gibt keine
// Normzeiten vor und berechnet weder Einstufung noch Rechnung. Erfasste Leistungen werden nur storniert, nie gelöscht.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isCategory = (value: unknown): value is string =>
  typeof value === "string" && (SERVICE_CATEGORIES as readonly string[]).includes(value);

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "documentation.write")) throw new ApiError("Keine Berechtigung.", 403);
}

function minutesOf(value: unknown, label: string, required: boolean) {
  if (!required && (value === null || value === undefined || value === "")) return null;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SERVICE_MINUTES)
    throw new ApiError(`${label}: bitte ganze Minuten zwischen 1 und ${MAX_SERVICE_MINUTES} angeben.`);
  return minutes;
}

const catalogItem = (row: Row): ServiceCatalogItem => ({
  id: String(row.id),
  name: String(row.name),
  category: String(row.category),
  code: String(row.code ?? ""),
  defaultMinutes:
    row.default_minutes === null || row.default_minutes === undefined ? null : Number(row.default_minutes),
  active: Boolean(row.active),
});

const record = (row: Row): ServiceRecord => ({
  id: String(row.id),
  title: String(row.title),
  category: String(row.category),
  code: String(row.code ?? ""),
  minutes: Number(row.minutes),
  performedAt: iso(row.performed_at) ?? "",
  performedBy: String(row.performed_by_name ?? "Unbekannt"),
  source: String(row.source) as ServiceSource,
  note: String(row.note ?? ""),
  cancelledAt: iso(row.cancelled_at),
  cancelReason: String(row.cancel_reason ?? ""),
});

async function today(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT (NOW() AT TIME ZONE timezone)::date::text AS today FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(rows[0]?.today);
}

export async function listCatalog(ctx: ApiContext, includeInactive = false) {
  const rows = (await ctx.sql`
    SELECT * FROM carecore_service_catalog
    WHERE organization_id = ${ctx.actor.organizationId} AND (${includeInactive} OR active)
    ORDER BY active DESC, category, lower(name)`) as Row[];
  return rows.map(catalogItem);
}

// Tag einer Person: erfasste Leistungen, Vorschläge aus Aufgaben und Massnahmen, Katalog.
export async function serviceDay(ctx: ApiContext, residentInput: unknown, dayInput: unknown): Promise<ServiceDay> {
  const residentId = await assertResident(ctx, residentInput);
  const day = typeof dayInput === "string" && DAY.test(dayInput) ? dayInput : await today(ctx);
  const org = ctx.actor.organizationId;
  const [records, tasks, interventions, catalog] = (await Promise.all([
    ctx.sql`
      SELECT s.*, COALESCE(u.display_name, 'Unbekannt') AS performed_by_name
      FROM carecore_service_records s
      JOIN carecore_organizations o ON o.id = s.organization_id
      LEFT JOIN carecore_users u ON u.id = s.performed_by
      WHERE s.organization_id = ${org} AND s.resident_id = ${residentId}
        AND s.performed_at >= (${day}::date)::timestamp AT TIME ZONE o.timezone
        AND s.performed_at < (${day}::date + 1)::timestamp AT TIME ZONE o.timezone
      ORDER BY s.performed_at, s.created_at`,
    // Erledigte (auch teilweise erledigte) Aufgaben des Tages, für die noch keine Leistung erfasst ist.
    ctx.sql`
      SELECT t.id, t.title, t.category, t.completed_at, COALESCE(u.display_name, '') AS completed_by
      FROM carecore_tasks t
      JOIN carecore_organizations o ON o.id = t.organization_id
      LEFT JOIN carecore_users u ON u.id = t.completed_by
      WHERE t.organization_id = ${org} AND t.resident_id = ${residentId} AND t.status IN ('completed', 'partial')
        AND t.completed_at >= (${day}::date)::timestamp AT TIME ZONE o.timezone
        AND t.completed_at < (${day}::date + 1)::timestamp AT TIME ZONE o.timezone
        AND NOT EXISTS (SELECT 1 FROM carecore_service_records s
          WHERE s.source = 'task' AND s.source_id = t.id AND s.cancelled_at IS NULL)
      ORDER BY t.completed_at`,
    // Laufende Massnahmen der Pflegeplanung, mit der Anzahl an diesem Tag bereits erfasster Leistungen.
    ctx.sql`
      SELECT i.id, i.title, i.frequency, g.category,
        (SELECT COUNT(*)::int FROM carecore_service_records s
          JOIN carecore_organizations o ON o.id = s.organization_id
          WHERE s.source = 'intervention' AND s.source_id = i.id AND s.cancelled_at IS NULL
            AND s.performed_at >= (${day}::date)::timestamp AT TIME ZONE o.timezone
            AND s.performed_at < (${day}::date + 1)::timestamp AT TIME ZONE o.timezone) AS recorded
      FROM carecore_interventions i
      JOIN carecore_care_goals g ON g.id = i.care_goal_id AND g.status = 'active'
      JOIN carecore_care_plans p ON p.id = g.care_plan_id AND p.status IN ('active', 'review')
      WHERE p.resident_id = ${residentId} AND i.status = 'active'
      ORDER BY g.category, i.title`,
    ctx.sql`
      SELECT * FROM carecore_service_catalog WHERE organization_id = ${org} AND active
      ORDER BY category, lower(name)`,
  ])) as Row[][];

  const items = catalog.map(catalogItem);
  const match = (title: string) => items.find((item) => item.name.toLowerCase() === title.trim().toLowerCase());
  const suggestions: ServiceSuggestion[] = [
    ...tasks.map((row): ServiceSuggestion => {
      const found = match(String(row.title));
      return {
        source: "task",
        sourceId: String(row.id),
        title: String(row.title),
        category: found?.category ?? (isCategory(row.category) ? row.category : "Pflege"),
        detail: ["Aufgabe erledigt", row.completed_by].filter(Boolean).join(" · "),
        catalogId: found?.id ?? null,
        performedAt: iso(row.completed_at),
      };
    }),
    ...interventions.map((row): ServiceSuggestion => {
      const found = match(String(row.title));
      const recorded = Number(row.recorded);
      return {
        source: "intervention",
        sourceId: String(row.id),
        title: String(row.title),
        category: found?.category ?? (isCategory(row.category) ? row.category : "Pflege"),
        detail: [row.frequency, recorded ? `an diesem Tag ${recorded}× erfasst` : ""].filter(Boolean).join(" · "),
        catalogId: found?.id ?? null,
        performedAt: null,
      };
    }),
  ];
  return {
    residentId,
    day,
    canWrite: hasPermission(ctx.actor, "documentation.write"),
    records: records.map(record),
    suggestions,
    catalog: items,
  };
}

export async function createServiceRecord(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, body.residentId);
  const org = ctx.actor.organizationId;
  const source = (["manual", "task", "intervention"] as const).find((item) => item === body.source) ?? "manual";
  const sourceId = source === "manual" ? null : assertUuid(body.sourceId, source === "task" ? "Aufgabe" : "Massnahme");
  if (source === "task") {
    const rows = await ctx.sql`
      SELECT 1 FROM carecore_tasks WHERE id = ${sourceId} AND organization_id = ${org} AND resident_id = ${residentId}
        AND status IN ('completed', 'partial')`;
    if (!rows[0]) throw new ApiError("Erledigte Aufgabe nicht gefunden.", 404);
  }
  if (source === "intervention") {
    const rows = await ctx.sql`
      SELECT 1 FROM carecore_interventions i
      JOIN carecore_care_goals g ON g.id = i.care_goal_id
      JOIN carecore_care_plans p ON p.id = g.care_plan_id
      WHERE i.id = ${sourceId} AND p.resident_id = ${residentId}`;
    if (!rows[0]) throw new ApiError("Massnahme nicht gefunden.", 404);
  }
  let catalog: ServiceCatalogItem | null = null;
  if (body.catalogId) {
    const id = assertUuid(body.catalogId, "Leistung");
    const rows = (await ctx.sql`
      SELECT * FROM carecore_service_catalog WHERE id = ${id} AND organization_id = ${org} AND active`) as Row[];
    if (!rows[0]) throw new ApiError("Leistung nicht im Katalog gefunden.", 404);
    catalog = catalogItem(rows[0]);
  }
  const title = text(body.title, 160) || catalog?.name || "";
  if (!title) throw new ApiError("Bitte die Leistung bezeichnen.");
  const category = isCategory(body.category) ? body.category : catalog?.category;
  if (!category) throw new ApiError("Bitte einen Bereich wählen.");
  const minutes = minutesOf(body.minutes, "Zeit", true) as number;
  const performedAt = typeof body.performedAt === "string" ? new Date(body.performedAt) : new Date();
  if (Number.isNaN(performedAt.getTime())) throw new ApiError("Zeitpunkt ist ungültig.");
  if (performedAt.getTime() > Date.now() + 5 * 60_000)
    throw new ApiError("Leistungen können erst erfasst werden, wenn sie erbracht sind.");
  const note = text(body.note, 2000);
  const code = catalog?.code ?? "";
  const id = randomUUID();
  try {
    await ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_service_records (id, organization_id, resident_id, care_unit_id, catalog_id, title, category,
          code, minutes, performed_at, performed_by, source, source_id, note, created_by)
        VALUES (${id}, ${org}, ${residentId},
          (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL
            ORDER BY started_at DESC LIMIT 1),
          ${catalog?.id ?? null}, ${title}, ${category}, ${code}, ${minutes}, ${performedAt.toISOString()},
          ${ctx.actor.id}, ${source}, ${sourceId}, ${note}, ${ctx.actor.id})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "service_record",
        entityId: id,
        action: "created",
        after: { title, category, code, minutes, performedAt: performedAt.toISOString(), source, note },
      }),
    ]);
  } catch (error) {
    if (String(error).includes("carecore_service_records_task_idx"))
      throw new ApiError("Für diese Aufgabe ist bereits eine Leistung erfasst.", 409);
    throw error;
  }
  return { id };
}

// Stornieren statt löschen: die Leistung bleibt mit Begründung sichtbar und zählt nicht mehr.
export async function cancelServiceRecord(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const id = assertUuid(idInput, "Leistung");
  const reason = text(body.reason, 1000);
  if (!reason) throw new ApiError("Bitte eine Begründung für die Stornierung angeben.");
  const rows = (await ctx.sql`
    SELECT id, resident_id, title, minutes, cancelled_at FROM carecore_service_records
    WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  const before = rows[0];
  if (!before) throw new ApiError("Leistung nicht gefunden.", 404);
  if (before.cancelled_at) throw new ApiError("Die Leistung ist bereits storniert.", 409);
  try {
    await ctx.sql.transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_service_records SET cancelled_at = NOW(), cancelled_by = ${ctx.actor.id},
          cancel_reason = ${reason}
        WHERE id = ${id} AND cancelled_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'SERVICE_CANCELLED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(before.resident_id),
        entityType: "service_record",
        entityId: id,
        action: "cancelled",
        before: { title: before.title, minutes: Number(before.minutes) },
        after: { title: before.title, minutes: Number(before.minutes), cancelReason: reason },
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("SERVICE_CANCELLED"))
      throw new ApiError("Die Leistung ist bereits storniert.", 409);
    throw error;
  }
}

// Leistungskatalog der Einrichtung anlegen oder ändern (Administration).
export async function saveCatalogItem(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  if (!hasPermission(ctx.actor, "administration.manage")) throw new ApiError("Keine Berechtigung.", 403);
  const name = text(body.name, 160);
  if (!name) throw new ApiError("Bitte die Leistung bezeichnen.");
  if (!isCategory(body.category)) throw new ApiError("Bitte einen Bereich wählen.");
  const input = {
    name,
    category: body.category,
    code: text(body.code, 40),
    defaultMinutes: minutesOf(body.defaultMinutes, "Vorschlag Minuten", false),
    active: body.active !== false,
  };
  const org = ctx.actor.organizationId;
  try {
    if (!idInput) {
      const id = randomUUID();
      await ctx.sql.transaction([
        ctx.sql`
          INSERT INTO carecore_service_catalog (id, organization_id, name, category, code, default_minutes, active)
          VALUES (${id}, ${org}, ${input.name}, ${input.category}, ${input.code}, ${input.defaultMinutes}, ${input.active})`,
        auditStatement(ctx, "service_catalog", id, "created", null, input),
      ]);
      return { id };
    }
    const id = assertUuid(idInput, "Leistung");
    const rows = (await ctx.sql`
      SELECT * FROM carecore_service_catalog WHERE id = ${id} AND organization_id = ${org}`) as Row[];
    if (!rows[0]) throw new ApiError("Leistung nicht im Katalog gefunden.", 404);
    const before = catalogItem(rows[0]);
    await ctx.sql.transaction([
      ctx.sql`
        UPDATE carecore_service_catalog SET name = ${input.name}, category = ${input.category}, code = ${input.code},
          default_minutes = ${input.defaultMinutes}, active = ${input.active}, updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${org}`,
      auditStatement(
        ctx,
        "service_catalog",
        id,
        "updated",
        {
          name: before.name,
          category: before.category,
          code: before.code,
          defaultMinutes: before.defaultMinutes,
          active: before.active,
        },
        input,
      ),
    ]);
    return { id };
  } catch (error) {
    if (String(error).includes("carecore_service_catalog_name_idx"))
      throw new ApiError("Eine Leistung mit dieser Bezeichnung gibt es bereits.", 409);
    throw error;
  }
}

// Monatsauswertung: Minuten je Person und Bereich, ohne stornierte Leistungen; Wohnbereich zum Zeitpunkt der Erfassung.
export async function serviceReport(
  ctx: ApiContext,
  monthInput: unknown,
  careUnitInput: string | null,
): Promise<ServiceReport> {
  const month = parseMonth(monthInput);
  if (!month) throw new ApiError("Monat ist ungültig.");
  const careUnitId = careUnitInput ? assertUuid(careUnitInput, "Wohnbereich") : null;
  const start = `${month}-01`;
  const rows = (await ctx.sql`
    SELECT s.resident_id, r.first_name || ' ' || r.last_name AS resident_name, COALESCE(ro.name, '') AS room,
      COALESCE(cu.name, '') AS care_unit, s.performed_at, s.title, s.category, s.code, s.minutes, s.source,
      COALESCE(u.display_name, 'Unbekannt') AS performed_by
    FROM carecore_service_records s
    JOIN carecore_organizations o ON o.id = s.organization_id
    JOIN carecore_residents r ON r.id = s.resident_id
    LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id
      ORDER BY (ended_at IS NULL) DESC, started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    LEFT JOIN carecore_care_units cu ON cu.id = s.care_unit_id
    LEFT JOIN carecore_users u ON u.id = s.performed_by
    WHERE s.organization_id = ${ctx.actor.organizationId} AND s.cancelled_at IS NULL
      AND s.performed_at >= (${start}::date)::timestamp AT TIME ZONE o.timezone
      AND s.performed_at < ((${start}::date + INTERVAL '1 month')::date)::timestamp AT TIME ZONE o.timezone
      AND (${careUnitId}::uuid IS NULL OR s.care_unit_id = ${careUnitId}::uuid)
    ORDER BY r.last_name, r.first_name, s.performed_at`) as Row[];

  const residents = new Map<string, ServiceReportResident>();
  const used = new Set<string>();
  for (const row of rows) {
    const id = String(row.resident_id);
    const entry = residents.get(id) ?? {
      id,
      name: String(row.resident_name),
      room: String(row.room),
      careUnit: String(row.care_unit),
      minutes: 0,
      count: 0,
      byCategory: {},
    };
    const minutes = Number(row.minutes);
    const category = String(row.category);
    entry.minutes += minutes;
    entry.count += 1;
    entry.byCategory[category] = (entry.byCategory[category] ?? 0) + minutes;
    used.add(category);
    residents.set(id, entry);
  }
  const order = [...SERVICE_CATEGORIES] as string[];
  return {
    month,
    careUnitId,
    minutes: rows.reduce((sum, row) => sum + Number(row.minutes), 0),
    count: rows.length,
    categories: [...used].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    residents: [...residents.values()],
    rows: rows.map((row) => ({
      residentName: String(row.resident_name),
      performedAt: iso(row.performed_at) ?? "",
      title: String(row.title),
      category: String(row.category),
      code: String(row.code ?? ""),
      minutes: Number(row.minutes),
      performedBy: String(row.performed_by),
      source: String(row.source) as ServiceSource,
    })),
  };
}
