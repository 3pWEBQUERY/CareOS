import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import {
  DEVICE_CHECK_RESULTS,
  type Device,
  type DeviceCheck,
  type DeviceCheckResult,
  type DeviceOverview,
} from "@/lib/devices-shared";

// Geräte und Hilfsmittel der Einrichtung: Verzeichnis, Prüfungen, Erinnerung bei fälliger Prüfung. Die Frist bis zur
// nächsten Prüfung legt die Einrichtung bzw. der Hersteller fest (Monate je Gerät oder Datum bei der Prüfung).

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINK = "/c/leitung/qualitaet/geraete";

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "quality.manage")) throw new ApiError("Keine Berechtigung.", 403);
}

async function today(ctx: ApiContext) {
  const [row] = (await ctx.sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(row.day);
}

const day = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value)) throw new ApiError(`${label} ist ungültig.`);
  return value;
};

const toCheck = (row: Row): DeviceCheck => ({
  id: String(row.id),
  checkedOn: String(row.checked_day),
  result: row.result as DeviceCheckResult,
  findings: String(row.findings),
  performedBy: String(row.performed_by),
  nextDueOn: (row.next_day as string | null) ?? null,
  recordedBy: (row.recorded_by_name as string | null) ?? null,
});

export async function deviceOverview(ctx: ApiContext): Promise<DeviceOverview> {
  const org = ctx.actor.organizationId;
  const [devices, checks, day0] = await Promise.all([
    ctx.sql`
      SELECT d.*, to_char(d.next_due_on, 'YYYY-MM-DD') AS next_day FROM carecore_devices d
      WHERE d.organization_id = ${org}
      ORDER BY d.retired_at IS NOT NULL, d.next_due_on NULLS LAST, d.name` as Promise<Row[]>,
    ctx.sql`
      SELECT c.*, to_char(c.checked_on, 'YYYY-MM-DD') AS checked_day, to_char(c.next_due_on, 'YYYY-MM-DD') AS next_day,
        u.display_name AS recorded_by_name
      FROM carecore_device_checks c LEFT JOIN carecore_users u ON u.id = c.recorded_by
      WHERE c.organization_id = ${org} ORDER BY c.checked_on DESC, c.created_at DESC` as Promise<Row[]>,
    today(ctx),
  ]);
  const list: Device[] = devices.map((row) => {
    const own = checks.filter((check) => check.device_id === row.id).map(toCheck);
    const nextDueOn = (row.next_day as string | null) ?? null;
    return {
      id: String(row.id),
      name: String(row.name),
      category: String(row.category),
      inventoryNumber: String(row.inventory_number),
      manufacturer: String(row.manufacturer),
      location: String(row.location),
      intervalMonths: row.interval_months === null ? null : Number(row.interval_months),
      nextDueOn,
      due: !row.retired_at && nextDueOn !== null && nextDueOn <= day0,
      notes: String(row.notes),
      retired: row.retired_at ? { at: iso(row.retired_at) ?? "", reason: String(row.retired_reason) } : null,
      lastCheck: own[0] ?? null,
      checks: own,
    };
  });
  return {
    canWrite: hasPermission(ctx.actor, "quality.manage"),
    today: day0,
    devices: list,
    categories: [...new Set(list.map((device) => device.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  };
}

// Anlegen oder ändern ({ id?, name, category, inventoryNumber, manufacturer, location, intervalMonths, nextDueOn, notes }).
export async function saveDevice(ctx: ApiContext, body: Record<string, unknown>) {
  assertWrite(ctx);
  const name = text(body.name, 160);
  if (!name) throw new ApiError("Bitte das Gerät benennen.");
  const months =
    body.intervalMonths === null || body.intervalMonths === undefined || body.intervalMonths === ""
      ? null
      : Number(body.intervalMonths);
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120))
    throw new ApiError("Die Frist ist ungültig (1 bis 120 Monate).");
  const data = {
    name,
    category: text(body.category, 80),
    inventoryNumber: text(body.inventoryNumber, 60),
    manufacturer: text(body.manufacturer, 160),
    location: text(body.location, 200),
    intervalMonths: months,
    nextDueOn: day(body.nextDueOn, "Das Datum der nächsten Prüfung"),
    notes: text(body.notes, 2000),
  };
  if (body.id) {
    const id = assertUuid(body.id, "Gerät");
    const [before] = (await ctx.sql`
      SELECT name, category, inventory_number, location, interval_months, to_char(next_due_on, 'YYYY-MM-DD') AS next_day
      FROM carecore_devices WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
    if (!before) throw new ApiError("Gerät nicht gefunden.", 404);
    await ctx.sql.transaction([
      ctx.sql`
        UPDATE carecore_devices SET name = ${data.name}, category = ${data.category},
          inventory_number = ${data.inventoryNumber}, manufacturer = ${data.manufacturer}, location = ${data.location},
          interval_months = ${data.intervalMonths}, next_due_on = ${data.nextDueOn}, notes = ${data.notes},
          updated_at = NOW()
        WHERE id = ${id}`,
      auditStatement(
        ctx,
        "device",
        id,
        "updated",
        {
          name: before.name,
          category: before.category,
          inventoryNumber: before.inventory_number,
          intervalMonths: before.interval_months,
          nextDueOn: before.next_day,
        },
        data,
      ),
    ]);
    return { id };
  }
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_devices (id, organization_id, name, category, inventory_number, manufacturer, location,
        interval_months, next_due_on, notes, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${data.name}, ${data.category}, ${data.inventoryNumber},
        ${data.manufacturer}, ${data.location}, ${data.intervalMonths}, ${data.nextDueOn}, ${data.notes}, ${ctx.actor.id})`,
    auditStatement(ctx, "device", id, "created", null, data),
  ]);
  return { id };
}

// Prüfung erfassen ({ checkedOn, result, findings, performedBy, nextDueOn? }). Ohne Datum der nächsten Prüfung gilt die
// Frist des Geräts ab dem Prüfdatum; ohne Frist bleibt die nächste Prüfung offen.
export async function recordDeviceCheck(ctx: ApiContext, deviceInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const deviceId = assertUuid(deviceInput, "Gerät");
  const [device] = (await ctx.sql`
    SELECT id, name, interval_months, retired_at FROM carecore_devices
    WHERE id = ${deviceId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!device) throw new ApiError("Gerät nicht gefunden.", 404);
  if (device.retired_at) throw new ApiError("Das Gerät ist ausser Betrieb.", 409);
  const checkedOn = day(body.checkedOn, "Das Prüfdatum");
  if (!checkedOn) throw new ApiError("Bitte das Prüfdatum angeben.");
  const day0 = await today(ctx);
  if (checkedOn > day0) throw new ApiError("Das Prüfdatum liegt in der Zukunft.");
  const result = String(body.result ?? "");
  if (!(result in DEVICE_CHECK_RESULTS)) throw new ApiError("Bitte das Ergebnis wählen.");
  const findings = text(body.findings, 2000);
  if (result === "defect" && !findings) throw new ApiError("Bitte die Mängel beschreiben.");
  const performedBy = text(body.performedBy, 200);
  if (!performedBy) throw new ApiError("Bitte angeben, wer geprüft hat.");
  const explicit = day(body.nextDueOn, "Das Datum der nächsten Prüfung");
  if (explicit && explicit <= checkedOn) throw new ApiError("Die nächste Prüfung muss nach dem Prüfdatum liegen.");
  const id = randomUUID();
  const months = device.interval_months === null ? null : Number(device.interval_months);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_device_checks (id, organization_id, device_id, checked_on, result, findings, performed_by,
        next_due_on, recorded_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${deviceId}, ${checkedOn}, ${result}, ${findings}, ${performedBy},
        COALESCE(${explicit}::date, CASE WHEN ${months}::int IS NULL THEN NULL
          ELSE (${checkedOn}::date + make_interval(months => ${months}::int))::date END),
        ${ctx.actor.id})`,
    ctx.sql`
      UPDATE carecore_devices SET next_due_on = (SELECT next_due_on FROM carecore_device_checks WHERE id = ${id}),
        updated_at = NOW()
      WHERE id = ${deviceId}`,
    auditStatement(ctx, "device", deviceId, "checked", null, {
      name: device.name,
      checkedOn,
      result,
      findings,
      performedBy,
    }),
  ]);
  return { id };
}

// Ausser Betrieb nehmen ({ reason }); bleibt mit Prüfungen im Verzeichnis.
export async function retireDevice(ctx: ApiContext, deviceInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const deviceId = assertUuid(deviceInput, "Gerät");
  const reason = text(body.reason, 500);
  if (!reason) throw new ApiError("Bitte den Grund angeben.");
  const [device] = (await ctx.sql`
    SELECT id, name, retired_at FROM carecore_devices WHERE id = ${deviceId} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!device) throw new ApiError("Gerät nicht gefunden.", 404);
  if (device.retired_at) throw new ApiError("Das Gerät ist bereits ausser Betrieb.", 409);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_devices SET retired_at = NOW(), retired_reason = ${reason}, updated_at = NOW()
      WHERE id = ${deviceId} AND retired_at IS NULL`,
    auditStatement(ctx, "device", deviceId, "retired", null, { name: device.name, reason }),
  ]);
}

// Erinnerung beim Laden der Benachrichtigungen: fällige Prüfungen für Personen mit „quality.manage“, je Gerät einmal
// pro Prüfzyklus (bis zur nächsten erfassten Prüfung).
export async function createDeviceReminders(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "quality.manage")) return;
  await ctx.sql`
    WITH due AS (
      SELECT d.id, d.name, d.next_due_on,
        (SELECT MAX(c.created_at) FROM carecore_device_checks c WHERE c.device_id = d.id) AS last_check_at
      FROM carecore_devices d JOIN carecore_organizations o ON o.id = d.organization_id
      WHERE d.organization_id = ${ctx.actor.organizationId} AND d.retired_at IS NULL AND d.next_due_on IS NOT NULL
        AND d.next_due_on <= (NOW() AT TIME ZONE o.timezone)::date)
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    SELECT gen_random_uuid(), ${ctx.actor.id}, 'Prüfung fällig: ' || due.name,
      'Nächste Prüfung am ' || to_char(due.next_due_on, 'DD.MM.YYYY') || ' (Frist der Einrichtung bzw. des Herstellers).',
      'device_check_due', 'normal', ${LINK}, 'device', due.id
    FROM due
    WHERE NOT EXISTS (SELECT 1 FROM carecore_notifications n
      WHERE n.user_id = ${ctx.actor.id} AND n.type = 'device_check_due' AND n.entity_type = 'device' AND n.entity_id = due.id
        AND n.created_at > COALESCE(due.last_check_at, '-infinity'::timestamptz))`;
}
