import { randomUUID } from "node:crypto";
import { readHiddenVitals } from "@/lib/settings";
import {
  ApiError,
  assertResident,
  assertUuid,
  iso,
  num,
  text,
  auditStatement,
  type ApiContext,
  type Row,
} from "@/lib/api-context";
import {
  VITAL_METRICS,
  evaluateVital,
  metricByKey,
  type EffectiveThreshold,
  type LatestVital,
  type Threshold,
  type ThresholdRow,
  type VitalMeasurement,
  type VitalResident,
  type VitalStatus,
} from "@/lib/vitals-shared";
import { initials } from "@/lib/medication-shared";
import { residentAudit } from "@/lib/resident-audit";
import { receiptStatements, withReceipt } from "@/lib/request-receipts";
import { auditOrigin } from "@/lib/audit-origin";

const severity: Record<VitalStatus, number> = { normal: 0, attention: 1, critical: 2 };

function thresholdFromRow(row: Row): Threshold {
  return {
    targetLower: num(row.lower_bound),
    targetUpper: num(row.upper_bound),
    criticalLower: num(row.critical_lower),
    criticalUpper: num(row.critical_upper),
  };
}

// Resident-specific threshold, else the organization's, else the built-in default.
export async function effectiveThresholds(ctx: ApiContext, residentId: string | null) {
  const rows = (await ctx.sql`
    SELECT id, resident_id, metric, lower_bound, upper_bound, critical_lower, critical_upper, reason
    FROM carecore_vital_thresholds
    WHERE active AND ((resident_id IS NULL AND organization_id = ${ctx.actor.organizationId}) OR resident_id = ${residentId})`) as Row[];
  const result = new Map<string, EffectiveThreshold>();
  for (const metric of VITAL_METRICS) {
    const own = rows.find((row) => row.metric === metric.key && row.resident_id);
    const house = rows.find((row) => row.metric === metric.key && !row.resident_id);
    const row = own ?? house;
    if (row)
      result.set(metric.key, {
        ...thresholdFromRow(row),
        id: String(row.id),
        source: own ? "resident" : "organization",
        reason: (row.reason as string | null) ?? null,
      });
    else if (metric.defaults) result.set(metric.key, { ...metric.defaults, id: null, source: "default", reason: null });
    else
      result.set(metric.key, {
        targetLower: null,
        targetUpper: null,
        criticalLower: null,
        criticalUpper: null,
        id: null,
        source: "none",
        reason: null,
      });
  }
  return result;
}

// ---------------------------------------------------------------- overview

export async function vitalsOverview(ctx: ApiContext) {
  const { sql, actor } = ctx;
  const [residents, latest, units, today, hidden] = (await Promise.all([
    sql`
      SELECT r.id, r.first_name, r.last_name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit, cu.id AS care_unit_id
      FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      WHERE r.organization_id = ${actor.organizationId} AND r.status = 'active'
      ORDER BY r.last_name, r.first_name`,
    sql`
      SELECT DISTINCT ON (m.resident_id, m.metric) m.resident_id, m.metric, m.value, m.secondary_value, m.status, m.measured_at
      FROM carecore_vital_measurements m
      JOIN carecore_residents r ON r.id = m.resident_id AND r.organization_id = ${actor.organizationId} AND r.status = 'active'
      ORDER BY m.resident_id, m.metric, m.measured_at DESC`,
    sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
      WHERE si.organization_id = ${actor.organizationId} AND cu.active = TRUE ORDER BY cu.name`,
    sql`
      SELECT COUNT(*)::int AS count FROM carecore_vital_measurements m
      JOIN carecore_residents r ON r.id = m.resident_id AND r.organization_id = ${actor.organizationId}
      CROSS JOIN (SELECT timezone FROM carecore_organizations WHERE id = ${actor.organizationId}) org
      WHERE (m.measured_at AT TIME ZONE org.timezone)::date = (NOW() AT TIME ZONE org.timezone)::date`,
    readHiddenVitals(ctx),
  ])) as [Row[], Row[], Row[], Row[], string[]];
  const list: VitalResident[] = residents.map((row) => {
    const name = `${row.first_name} ${row.last_name}`;
    const values: Record<string, LatestVital> = {};
    // Nicht erfasste Vitalparameter zählen weder für den Status noch für Hinweise.
    for (const entry of latest.filter((item) => item.resident_id === row.id && !hidden.includes(String(item.metric))))
      values[String(entry.metric)] = {
        value: Number(entry.value),
        secondary: num(entry.secondary_value),
        status: entry.status as VitalStatus,
        measuredAt: iso(entry.measured_at) ?? "",
      };
    const entries = Object.values(values);
    return {
      id: String(row.id),
      name,
      initials: initials(name),
      room: String(row.room),
      careUnit: String(row.care_unit),
      careUnitId: (row.care_unit_id as string | null) ?? null,
      latest: values,
      status: entries.length
        ? entries.reduce<VitalStatus>((worst, e) => (severity[e.status] > severity[worst] ? e.status : worst), "normal")
        : null,
      lastMeasuredAt: entries.length
        ? entries
            .map((e) => e.measuredAt)
            .sort()
            .at(-1)!
        : null,
    };
  });
  return {
    residents: list,
    careUnits: units.map((unit) => ({ id: String(unit.id), name: String(unit.name) })),
    measurementsToday: Number(today[0]?.count ?? 0),
  };
}

// ------------------------------------------------------------ measurements

type MeasurementInput = { value?: unknown; secondary?: unknown };

export async function recordMeasurements(
  ctx: ApiContext,
  body: Record<string, unknown>,
  requestId: string | null = null,
) {
  const residentId = await assertResident(ctx, body.residentId);
  const note = text(body.note, 2000);
  const measuredAt =
    typeof body.measuredAt === "string" && !Number.isNaN(Date.parse(body.measuredAt))
      ? new Date(body.measuredAt)
      : new Date();
  if (measuredAt.getTime() > Date.now() + 5 * 60_000) throw new ApiError("Der Messzeitpunkt liegt in der Zukunft.");
  if (measuredAt.getTime() < Date.now() - 7 * 86_400_000)
    throw new ApiError("Messungen können höchstens 7 Tage rückwirkend erfasst werden.");
  const values = (body.values ?? {}) as Record<string, MeasurementInput>;
  const [thresholds, hidden] = await Promise.all([effectiveThresholds(ctx, residentId), readHiddenVitals(ctx)]);
  const rows: Array<{ metric: string; value: number; secondary: number | null; unit: string; status: VitalStatus }> =
    [];
  for (const [key, input] of Object.entries(values)) {
    const metric = metricByKey(key);
    if (!metric) throw new ApiError(`Unbekannter Messwert: ${key}.`);
    if (hidden.includes(key)) throw new ApiError(`${key} wird in dieser Einrichtung nicht erfasst.`);
    const value = typeof input?.value === "number" && Number.isFinite(input.value) ? input.value : null;
    if (value === null) continue;
    const [min, max] = metric.plausible;
    if (value < min || value > max)
      throw new ApiError(
        `${metric.key} ${value} ${metric.unit} ist nicht plausibel (erlaubt ${min}–${max}). Bitte prüfen.`,
      );
    let secondary: number | null = null;
    if (metric.secondary) {
      secondary = typeof input.secondary === "number" && Number.isFinite(input.secondary) ? input.secondary : null;
      const [sMin, sMax] = metric.secondary.plausible;
      if (secondary === null || secondary < sMin || secondary > sMax)
        throw new ApiError(`Bitte einen plausiblen ${metric.secondary.label}en Wert (${sMin}–${sMax}) angeben.`);
      if (secondary >= value) throw new ApiError("Der diastolische Wert muss unter dem systolischen liegen.");
    }
    const threshold = thresholds.get(metric.key)!;
    rows.push({ metric: metric.key, value, secondary, unit: metric.unit, status: evaluateVital(value, threshold) });
  }
  if (!rows.length) throw new ApiError("Bitte mindestens einen Messwert eingeben.");
  const at = measuredAt.toISOString();
  const ids = rows.map(() => randomUUID());
  await withReceipt(() =>
    ctx.sql.transaction([
      ...rows.map(
        (row, index) => ctx.sql`
        INSERT INTO carecore_vital_measurements (id, resident_id, measured_by, measured_at, metric, value, unit, secondary_value, status, note)
        VALUES (${ids[index]}, ${residentId}, ${ctx.actor.id}, ${at}, ${row.metric}, ${row.value}, ${row.unit}, ${row.secondary}, ${row.status}, ${note || null})`,
      ),
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "vital_measurements",
        entityId: residentId,
        action: "recorded",
        after: { measuredAt: at, rows, note: note || null },
      }),
      ...receiptStatements(ctx, requestId),
    ]),
  );
  return rows.map(({ metric, status }) => ({ metric, status }));
}

export async function residentVitals(
  ctx: ApiContext,
  residentIdInput: unknown,
  metricInput: unknown,
  daysInput: unknown,
) {
  const residentId = await assertResident(ctx, residentIdInput);
  const metric = typeof metricInput === "string" && metricByKey(metricInput) ? metricInput : VITAL_METRICS[0].key;
  const days = [1, 7, 30, 90].includes(Number(daysInput)) ? Number(daysInput) : 7;
  const [rows, thresholds] = await Promise.all([
    ctx.sql`
      SELECT m.id, m.metric, m.value, m.secondary_value, m.unit, m.status, m.measured_at, m.note, u.display_name AS measured_by
      FROM carecore_vital_measurements m LEFT JOIN carecore_users u ON u.id = m.measured_by
      WHERE m.resident_id = ${residentId} AND m.metric = ${metric} AND m.measured_at > NOW() - make_interval(days => ${days})
      ORDER BY m.measured_at` as Promise<Row[]>,
    effectiveThresholds(ctx, residentId),
  ]);
  const measurements: VitalMeasurement[] = rows.map((row) => ({
    id: String(row.id),
    metric: String(row.metric),
    value: Number(row.value),
    secondary: num(row.secondary_value),
    unit: String(row.unit),
    status: row.status as VitalStatus,
    measuredAt: iso(row.measured_at) ?? "",
    measuredBy: (row.measured_by as string | null) ?? null,
    note: (row.note as string | null) ?? null,
  }));
  return { metric, days, measurements, threshold: thresholds.get(metric)!, thresholds: Object.fromEntries(thresholds) };
}

// -------------------------------------------------------------- thresholds

export async function listThresholds(ctx: ApiContext) {
  const [house, personal] = (await Promise.all([
    effectiveThresholds(ctx, null),
    ctx.sql`
      SELECT t.id, t.resident_id, t.metric, t.lower_bound, t.upper_bound, t.critical_lower, t.critical_upper, t.reason,
        r.first_name || ' ' || r.last_name AS resident_name
      FROM carecore_vital_thresholds t
      JOIN carecore_residents r ON r.id = t.resident_id AND r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
      WHERE t.active
      ORDER BY r.last_name, r.first_name, t.metric`,
  ])) as [Map<string, EffectiveThreshold>, Row[]];
  const personalRows: ThresholdRow[] = personal.map((row) => ({
    ...thresholdFromRow(row),
    id: String(row.id),
    source: "resident",
    reason: (row.reason as string | null) ?? null,
    metric: String(row.metric),
    residentId: String(row.resident_id),
    residentName: String(row.resident_name),
  }));
  return {
    house: VITAL_METRICS.map((metric) => ({
      ...house.get(metric.key)!,
      metric: metric.key,
      residentId: null,
      residentName: null,
    })),
    personal: personalRows,
  };
}

const bound = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export async function saveThreshold(ctx: ApiContext, body: Record<string, unknown>) {
  const metric = typeof body.metric === "string" ? metricByKey(body.metric) : undefined;
  if (!metric) throw new ApiError("Bitte einen Messwert wählen.");
  const threshold: Threshold = {
    targetLower: bound(body.targetLower),
    targetUpper: bound(body.targetUpper),
    criticalLower: bound(body.criticalLower),
    criticalUpper: bound(body.criticalUpper),
  };
  if (Object.values(threshold).every((value) => value === null))
    throw new ApiError("Bitte mindestens eine Grenze angeben.");
  const [min, max] = metric.plausible;
  for (const value of Object.values(threshold))
    if (value !== null && (value < min || value > max))
      throw new ApiError(`Grenzen müssen zwischen ${min} und ${max} ${metric.unit} liegen.`);
  const ordered = (lower: number | null, upper: number | null) => lower === null || upper === null || lower < upper;
  if (
    !ordered(threshold.targetLower, threshold.targetUpper) ||
    !ordered(threshold.criticalLower, threshold.criticalUpper)
  )
    throw new ApiError("Die untere Grenze muss unter der oberen liegen.");
  if (
    !ordered(threshold.criticalLower, threshold.targetLower) ||
    !ordered(threshold.targetUpper, threshold.criticalUpper)
  )
    throw new ApiError("Die Alarmgrenzen müssen ausserhalb des Zielbereichs liegen.");
  const reason = text(body.reason, 1000);
  const residentId = body.residentId ? await assertResident(ctx, body.residentId) : null;
  if (residentId && !reason)
    throw new ApiError("Bitte die Begründung bzw. ärztliche Anordnung für den persönlichen Zielbereich angeben.");
  const id = randomUUID();
  // The previous active threshold stays as history; the partial unique index guarantees one active row.
  await ctx.sql.transaction([
    residentId
      ? ctx.sql`UPDATE carecore_vital_thresholds SET active = FALSE WHERE active AND resident_id = ${residentId} AND metric = ${metric.key}`
      : ctx.sql`UPDATE carecore_vital_thresholds SET active = FALSE WHERE active AND resident_id IS NULL AND organization_id = ${ctx.actor.organizationId} AND metric = ${metric.key}`,
    ctx.sql`
      INSERT INTO carecore_vital_thresholds (id, resident_id, organization_id, metric, lower_bound, upper_bound, critical_lower, critical_upper, unit, reason, created_by)
      VALUES (${id}, ${residentId}, ${residentId ? null : ctx.actor.organizationId}, ${metric.key}, ${threshold.targetLower}, ${threshold.targetUpper},
        ${threshold.criticalLower}, ${threshold.criticalUpper}, ${metric.unit}, ${reason || null}, ${ctx.actor.id})`,
    residentId
      ? residentAudit(ctx.sql, ctx.actor, {
          residentId,
          entityType: "vital_threshold",
          entityId: id,
          action: "saved",
          after: { metric: metric.key, ...threshold, reason },
        })
      : auditStatement(ctx, "vital_threshold", id, "saved", null, {
          metric: metric.key,
          residentId,
          ...threshold,
          reason,
        }),
  ]);
  return id;
}

// Deactivates a threshold; the next level (organization or default) applies again.
export async function removeThreshold(
  ctx: ApiContext,
  thresholdIdInput: unknown,
  allowed: (scope: "resident" | "organization") => boolean,
  reason: string,
) {
  const id = assertUuid(thresholdIdInput, "Grenzwert");
  const [scope] = (await ctx.sql`
    SELECT t.resident_id, t.metric FROM carecore_vital_thresholds t
    WHERE t.id = ${id} AND t.active AND (
      t.organization_id = ${ctx.actor.organizationId}
      OR EXISTS (SELECT 1 FROM carecore_residents r WHERE r.id = t.resident_id AND r.organization_id = ${ctx.actor.organizationId}))`) as Row[];
  if (!scope) throw new ApiError("Grenzwert nicht gefunden.", 404);
  const residentId = (scope.resident_id as string | null) ?? null;
  if (!allowed(residentId ? "resident" : "organization"))
    throw new ApiError("Keine Berechtigung für diese Aktion.", 403);
  // Deaktivieren und Protokoll in einer Anweisung (bereits deaktiviert: keines von beiden).
  const before = { residentId, metric: String(scope.metric) };
  const rows = (await ctx.sql`
    WITH removed AS (UPDATE carecore_vital_thresholds SET active = FALSE WHERE id = ${id} AND active RETURNING id)
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, before_data, after_data)
    SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'vital_threshold', removed.id, 'removed',
      ${JSON.stringify(before)}::jsonb, ${JSON.stringify({ residentId, reason: reason || null })}::jsonb
    FROM removed RETURNING entity_id`) as Row[];
  if (!rows[0]) throw new ApiError("Grenzwert nicht gefunden.", 404);
  return { residentId };
}
