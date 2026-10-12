import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  BELONGING_KINDS,
  type Belonging,
  type BelongingInventory,
  type BelongingKind,
  type BelongingList,
} from "@/lib/belongings-shared";

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "residents.write")) throw new ApiError("Keine Berechtigung.", 403);
}

const toBelonging = (row: Row): Belonging => ({
  id: String(row.id),
  kind: row.kind as BelongingKind,
  name: String(row.name),
  quantity: Number(row.quantity ?? 1),
  marking: String(row.marking),
  location: String(row.location),
  note: String(row.note),
  updatedAt: iso(row.updated_at) ?? "",
  updatedBy: (row.updated_by_name as string | null) ?? null,
  removed: row.removed_at
    ? {
        at: iso(row.removed_at) ?? "",
        by: (row.removed_by_name as string | null) ?? null,
        reason: String(row.removed_reason),
      }
    : null,
});

// Vorhandene zuerst (nach Art: Hilfsmittel, persönliche Gegenstände, Kleidung, Einrichtung), danach nicht mehr vorhandene.
export async function readBelongings(ctx: ApiContext, residentId: string) {
  const rows = (await ctx.sql`
    SELECT b.*, u.display_name AS updated_by_name, r.display_name AS removed_by_name
    FROM carecore_resident_belongings b
    LEFT JOIN carecore_users u ON u.id = COALESCE(b.updated_by, b.created_by)
    LEFT JOIN carecore_users r ON r.id = b.removed_by
    WHERE b.resident_id = ${residentId}
    ORDER BY b.removed_at IS NOT NULL, b.removed_at DESC,
      array_position(ARRAY['aid', 'personal', 'clothing', 'furniture']::varchar[], b.kind), b.name`) as Row[];
  return rows.map(toBelonging);
}

export async function belongingList(ctx: ApiContext, residentInput: unknown): Promise<BelongingList> {
  const residentId = await assertResident(ctx, residentInput);
  return {
    residentId,
    canWrite: hasPermission(ctx.actor, "residents.write"),
    belongings: await readBelongings(ctx, residentId),
  };
}

// Inventarliste beim Eintritt: vorhandene Gegenstände mit Name, Zimmer, Wohnbereich und Eintrittsdatum.
export async function belongingInventory(ctx: ApiContext, residentInput: unknown): Promise<BelongingInventory> {
  const residentId = await assertResident(ctx, residentInput);
  const [[person], belongings] = await Promise.all([
    ctx.sql`
      SELECT o.name AS organization, r.last_name || ' ' || r.first_name AS name, COALESCE(ro.name, '') AS room,
        COALESCE(cu.name, '') AS care_unit, to_char((st.started_at AT TIME ZONE o.timezone)::date, 'YYYY-MM-DD') AS admitted
      FROM carecore_residents r JOIN carecore_organizations o ON o.id = r.organization_id
      LEFT JOIN LATERAL (SELECT * FROM carecore_resident_stays WHERE resident_id = r.id
        ORDER BY ended_at IS NULL DESC, started_at DESC LIMIT 1) st ON TRUE
      LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
      LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id
      WHERE r.id = ${residentId}` as Promise<Row[]>,
    readBelongings(ctx, residentId),
  ]);
  return {
    organization: String(person.organization),
    residentName: String(person.name),
    room: String(person.room),
    careUnit: String(person.care_unit),
    admittedOn: (person.admitted as string | null) ?? null,
    generatedAt: new Date().toISOString(),
    belongings: belongings.filter((item) => !item.removed),
  };
}

// Für das Protokoll: „location“ heisst dort bereits „Körperstelle“, daher „storedAt“ (Standort).
const auditData = (data: Record<string, unknown>) => ({
  kind: data.kind,
  name: data.name,
  quantity: data.quantity,
  marking: data.marking,
  storedAt: data.location,
  note: data.note,
});

function parse(body: Record<string, unknown>) {
  const name = text(body.name, 160);
  if (!name) throw new ApiError("Bitte den Gegenstand angeben.");
  const kind = String(body.kind ?? "aid");
  if (!(kind in BELONGING_KINDS)) throw new ApiError("Bitte die Art des Gegenstands wählen.");
  const quantity = body.quantity === undefined || body.quantity === "" ? 1 : Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
    throw new ApiError("Die Anzahl ist ungültig (1 bis 999).");
  return {
    kind: kind as BelongingKind,
    name,
    quantity,
    marking: text(body.marking, 160),
    location: text(body.location, 200),
    note: text(body.note, 2000),
  };
}

export async function createBelonging(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const data = parse(body);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_resident_belongings (id, organization_id, resident_id, kind, name, quantity, marking, location,
        note, created_by, updated_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${data.kind}, ${data.name}, ${data.quantity}, ${data.marking},
        ${data.location}, ${data.note}, ${ctx.actor.id}, ${ctx.actor.id})`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident_belonging",
      entityId: id,
      action: "created",
      after: auditData(data),
    }),
  ]);
  return belongingList(ctx, residentId);
}

async function load(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Gegenstand");
  const [row] = (await ctx.sql`
    SELECT *, updated_at::text AS stamp FROM carecore_resident_belongings
    WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Gegenstand nicht gefunden.", 404);
  if (row.removed_at) throw new ApiError("Der Gegenstand ist als nicht mehr vorhanden vermerkt.", 409);
  return row;
}

const conflict = () => new ApiError("Der Gegenstand wurde inzwischen geändert. Bitte neu laden.", 409);

// Ändern ({ kind, name, marking, location, note, updatedAt }); nur, wenn niemand anderes inzwischen geändert hat.
export async function updateBelonging(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const row = await load(ctx, idInput);
  const data = parse(body);
  if (typeof body.updatedAt === "string" && body.updatedAt !== iso(row.updated_at)) throw conflict();
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_resident_belongings SET kind = ${data.kind}, name = ${data.name}, quantity = ${data.quantity},
            marking = ${data.marking},
            location = ${data.location}, note = ${data.note}, updated_by = ${ctx.actor.id}, updated_at = NOW()
          WHERE id = ${row.id} AND removed_at IS NULL AND updated_at::text = ${String(row.stamp)} RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'BELONGING_CHANGED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(row.resident_id),
        entityType: "resident_belonging",
        entityId: String(row.id),
        action: "updated",
        before: auditData(row),
        after: auditData(data),
      }),
    ])
    .catch((error) => {
      if (String(error).includes("BELONGING_CHANGED")) throw conflict();
      throw error;
    });
  return belongingList(ctx, String(row.resident_id));
}

// Nicht mehr vorhanden ({ reason }, z. B. „nach Hause mitgegeben“, „verloren, gemeldet“); bleibt im Verlauf.
export async function removeBelonging(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const reason = text(body.reason, 500);
  if (!reason) throw new ApiError("Bitte den Grund angeben.");
  const row = await load(ctx, idInput);
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_resident_belongings SET removed_at = NOW(), removed_by = ${ctx.actor.id},
            removed_reason = ${reason}
          WHERE id = ${row.id} AND removed_at IS NULL RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'BELONGING_CHANGED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(row.resident_id),
        entityType: "resident_belonging",
        entityId: String(row.id),
        action: "removed",
        after: { name: row.name, reason },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("BELONGING_CHANGED")) throw conflict();
      throw error;
    });
  return belongingList(ctx, String(row.resident_id));
}
