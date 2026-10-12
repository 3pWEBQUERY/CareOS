import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import type { Fridge, FridgeOverview, FridgeReading } from "@/lib/fridges-shared";

// Temperaturprotokoll Medikamentenkühlschrank: Kühlschränke mit Grenzen und Messrhythmus der Einrichtung, Messungen mit
// Wert und Person, Erinnerung bei fälliger Messung bzw. Wert ausserhalb der Grenzen. CareOS gibt keine Grenzen vor.

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LINK = "/c/medikation/kuehlschrank";

function assertManage(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "medication.manage")) throw new ApiError("Keine Berechtigung.", 403);
}

function assertRecord(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "medication.administer") && !hasPermission(ctx.actor, "medication.manage"))
    throw new ApiError("Keine Berechtigung.", 403);
}

// Temperatur aus Eingabe ("4,5" oder 4.5) auf eine Stelle gerundet; null ohne Eingabe.
function celsius(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(number) || number < -50 || number > 60) throw new ApiError(`${label} ist ungültig.`);
  return Math.round(number * 10) / 10;
}

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

const toReading = (row: Row): FridgeReading => ({
  id: String(row.id),
  measuredAt: iso(row.measured_at) ?? "",
  celsius: Number(row.celsius),
  minCelsius: num(row.min_celsius),
  maxCelsius: num(row.max_celsius),
  outside: Boolean(row.outside),
  note: String(row.note),
  recordedBy: (row.recorded_by_name as string | null) ?? null,
});

export async function fridgeOverview(ctx: ApiContext): Promise<FridgeOverview> {
  assertRecord(ctx);
  const org = ctx.actor.organizationId;
  const [fridges, readings, latest] = (await Promise.all([
    ctx.sql`
      SELECT f.*, (f.interval_hours IS NOT NULL AND f.retired_at IS NULL AND COALESCE(
        (SELECT MAX(r.measured_at) FROM carecore_fridge_readings r WHERE r.fridge_id = f.id)
          + make_interval(hours => f.interval_hours) <= NOW(), TRUE)) AS due
      FROM carecore_fridges f WHERE f.organization_id = ${org}
      ORDER BY f.retired_at IS NOT NULL, f.name`,
    ctx.sql`
      SELECT r.*, u.display_name AS recorded_by_name FROM carecore_fridge_readings r
      LEFT JOIN carecore_users u ON u.id = r.recorded_by
      WHERE r.organization_id = ${org} AND r.measured_at > NOW() - INTERVAL '31 days'
      ORDER BY r.measured_at DESC, r.created_at DESC`,
    ctx.sql`
      SELECT DISTINCT ON (r.fridge_id) r.*, u.display_name AS recorded_by_name FROM carecore_fridge_readings r
      LEFT JOIN carecore_users u ON u.id = r.recorded_by
      WHERE r.organization_id = ${org}
      ORDER BY r.fridge_id, r.measured_at DESC, r.created_at DESC`,
  ])) as Row[][];
  return {
    canManage: hasPermission(ctx.actor, "medication.manage"),
    canRecord: true,
    fridges: fridges.map((row): Fridge => ({
      id: String(row.id),
      name: String(row.name),
      location: String(row.location),
      minCelsius: num(row.min_celsius),
      maxCelsius: num(row.max_celsius),
      intervalHours: num(row.interval_hours),
      notes: String(row.notes),
      retired: row.retired_at ? { at: iso(row.retired_at) ?? "", reason: String(row.retired_reason) } : null,
      lastReading: latest.filter((reading) => reading.fridge_id === row.id).map(toReading)[0] ?? null,
      due: Boolean(row.due),
      readings: readings.filter((reading) => reading.fridge_id === row.id).map(toReading),
    })),
  };
}

// Anlegen oder ändern ({ id?, name, location, minCelsius, maxCelsius, intervalHours, notes }).
export async function saveFridge(ctx: ApiContext, body: Record<string, unknown>) {
  assertManage(ctx);
  const name = text(body.name, 160);
  if (!name) throw new ApiError("Bitte den Kühlschrank benennen.");
  const minCelsius = celsius(body.minCelsius, "Die untere Grenze");
  const maxCelsius = celsius(body.maxCelsius, "Die obere Grenze");
  if (minCelsius !== null && maxCelsius !== null && minCelsius >= maxCelsius)
    throw new ApiError("Die untere Grenze muss unter der oberen liegen.");
  const hours =
    body.intervalHours === null || body.intervalHours === undefined || body.intervalHours === ""
      ? null
      : Number(body.intervalHours);
  if (hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > 744))
    throw new ApiError("Der Messrhythmus ist ungültig (1 bis 744 Stunden).");
  const data = {
    name,
    location: text(body.location, 200),
    minCelsius,
    maxCelsius,
    intervalHours: hours,
    notes: text(body.notes, 2000),
  };
  if (body.id) {
    const id = assertUuid(body.id, "Kühlschrank");
    const [before] = (await ctx.sql`
      SELECT name, location, min_celsius, max_celsius, interval_hours, retired_at FROM carecore_fridges
      WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
    if (!before) throw new ApiError("Kühlschrank nicht gefunden.", 404);
    if (before.retired_at) throw new ApiError("Der Kühlschrank ist ausser Betrieb.", 409);
    await ctx.sql.transaction([
      ctx.sql`
        UPDATE carecore_fridges SET name = ${data.name}, location = ${data.location}, min_celsius = ${data.minCelsius},
          max_celsius = ${data.maxCelsius}, interval_hours = ${data.intervalHours}, notes = ${data.notes},
          updated_at = NOW()
        WHERE id = ${id}`,
      auditStatement(
        ctx,
        "fridge",
        id,
        "updated",
        {
          name: before.name,
          location: before.location,
          minCelsius: num(before.min_celsius),
          maxCelsius: num(before.max_celsius),
          intervalHours: num(before.interval_hours),
        },
        data,
      ),
    ]);
    return { id };
  }
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_fridges (id, organization_id, name, location, min_celsius, max_celsius, interval_hours, notes,
        created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${data.name}, ${data.location}, ${data.minCelsius}, ${data.maxCelsius},
        ${data.intervalHours}, ${data.notes}, ${ctx.actor.id})`,
    auditStatement(ctx, "fridge", id, "created", null, data),
  ]);
  return { id };
}

// Messung erfassen ({ measuredAt: "YYYY-MM-DDTHH:MM" in Ortszeit der Einrichtung, celsius, note }). Liegt der Wert
// ausserhalb der Grenzen der Einrichtung, ist eine Bemerkung (getroffene Massnahme) nötig.
export async function recordFridgeReading(ctx: ApiContext, fridgeInput: unknown, body: Record<string, unknown>) {
  assertRecord(ctx);
  const fridgeId = assertUuid(fridgeInput, "Kühlschrank");
  const [fridge] = (await ctx.sql`
    SELECT f.id, f.name, f.min_celsius, f.max_celsius, f.retired_at, o.timezone FROM carecore_fridges f
    JOIN carecore_organizations o ON o.id = f.organization_id
    WHERE f.id = ${fridgeId} AND f.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!fridge) throw new ApiError("Kühlschrank nicht gefunden.", 404);
  if (fridge.retired_at) throw new ApiError("Der Kühlschrank ist ausser Betrieb.", 409);
  const value = celsius(body.celsius, "Die Temperatur");
  if (value === null) throw new ApiError("Bitte die Temperatur angeben.");
  const local = typeof body.measuredAt === "string" && LOCAL_TIME.test(body.measuredAt) ? body.measuredAt : null;
  if (!local) throw new ApiError("Bitte Datum und Uhrzeit der Messung angeben.");
  const [time] = (await ctx.sql`
    SELECT (${local}::timestamp AT TIME ZONE ${String(fridge.timezone)}) AS at,
      (${local}::timestamp AT TIME ZONE ${String(fridge.timezone)}) > NOW() + INTERVAL '5 minutes' AS future`) as Row[];
  if (time.future) throw new ApiError("Die Messung liegt in der Zukunft.");
  const minCelsius = num(fridge.min_celsius);
  const maxCelsius = num(fridge.max_celsius);
  const outside = (minCelsius !== null && value < minCelsius) || (maxCelsius !== null && value > maxCelsius);
  const note = text(body.note, 2000);
  if (outside && !note)
    throw new ApiError(
      "Der Wert liegt ausserhalb der Grenzen der Einrichtung. Bitte die getroffene Massnahme angeben.",
    );
  const id = randomUUID();
  const measuredAt = iso(time.at);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_fridge_readings (id, organization_id, fridge_id, measured_at, celsius, min_celsius, max_celsius,
        outside, note, recorded_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${fridgeId}, ${measuredAt}, ${value}, ${minCelsius}, ${maxCelsius},
        ${outside}, ${note}, ${ctx.actor.id})`,
    auditStatement(ctx, "fridge", fridgeId, "measured", null, {
      name: fridge.name,
      measuredAt,
      celsius: value,
      outside,
      note,
    }),
  ]);
  return { id, outside };
}

// Ausser Betrieb nehmen ({ reason }); bleibt mit seinen Messungen im Verzeichnis.
export async function retireFridge(ctx: ApiContext, fridgeInput: unknown, body: Record<string, unknown>) {
  assertManage(ctx);
  const fridgeId = assertUuid(fridgeInput, "Kühlschrank");
  const reason = text(body.reason, 500);
  if (!reason) throw new ApiError("Bitte den Grund angeben.");
  const [fridge] = (await ctx.sql`
    SELECT id, name, retired_at FROM carecore_fridges WHERE id = ${fridgeId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!fridge) throw new ApiError("Kühlschrank nicht gefunden.", 404);
  if (fridge.retired_at) throw new ApiError("Der Kühlschrank ist bereits ausser Betrieb.", 409);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_fridges SET retired_at = NOW(), retired_reason = ${reason}, updated_at = NOW()
      WHERE id = ${fridgeId} AND retired_at IS NULL`,
    auditStatement(ctx, "fridge", fridgeId, "retired", null, { name: fridge.name, reason }),
  ]);
}

// Erinnerungen beim Laden der Benachrichtigungen für Personen mit „medication.manage“: fällige Messung nach dem
// Messrhythmus der Einrichtung (einmal bis zur nächsten Messung) und letzte Messung ausserhalb der Grenzen (einmal je
// Messung).
export async function createFridgeReminders(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "medication.manage")) return;
  const org = ctx.actor.organizationId;
  await ctx.sql`
    WITH last AS (
      SELECT f.id, f.name, f.interval_hours,
        (SELECT MAX(r.measured_at) FROM carecore_fridge_readings r WHERE r.fridge_id = f.id) AS measured_at,
        (SELECT MAX(r.created_at) FROM carecore_fridge_readings r WHERE r.fridge_id = f.id) AS recorded_at
      FROM carecore_fridges f
      WHERE f.organization_id = ${org} AND f.retired_at IS NULL AND f.interval_hours IS NOT NULL),
    due AS (
      SELECT * FROM last
      WHERE measured_at IS NULL OR measured_at + make_interval(hours => interval_hours) <= NOW())
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    SELECT gen_random_uuid(), ${ctx.actor.id}, 'Temperatur messen: ' || due.name,
      CASE WHEN due.measured_at IS NULL THEN 'Noch keine Messung erfasst (Messrhythmus der Einrichtung).'
        ELSE 'Letzte Messung vor mehr als ' || due.interval_hours || ' Stunden (Messrhythmus der Einrichtung).' END,
      'fridge_reading_due', 'normal', ${LINK}, 'fridge', due.id
    FROM due
    WHERE NOT EXISTS (SELECT 1 FROM carecore_notifications n
      WHERE n.user_id = ${ctx.actor.id} AND n.type = 'fridge_reading_due' AND n.entity_type = 'fridge'
        AND n.entity_id = due.id AND n.created_at > COALESCE(due.recorded_at, '-infinity'::timestamptz))`;
  await ctx.sql`
    WITH latest AS (
      SELECT DISTINCT ON (r.fridge_id) r.id, r.celsius, r.note, f.name
      FROM carecore_fridge_readings r JOIN carecore_fridges f ON f.id = r.fridge_id
      WHERE r.organization_id = ${org} AND f.retired_at IS NULL
      ORDER BY r.fridge_id, r.measured_at DESC, r.created_at DESC)
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    SELECT gen_random_uuid(), ${ctx.actor.id}, 'Temperatur ausserhalb der Grenzen: ' || latest.name,
      to_char(latest.celsius, 'FM990.0') || ' °C · Massnahme: ' || latest.note,
      'fridge_temperature_outside', 'high', ${LINK}, 'fridge_reading', latest.id
    FROM latest
    JOIN carecore_fridge_readings r ON r.id = latest.id AND r.outside
    WHERE NOT EXISTS (SELECT 1 FROM carecore_notifications n
      WHERE n.user_id = ${ctx.actor.id} AND n.type = 'fridge_temperature_outside' AND n.entity_id = latest.id)`;
}
