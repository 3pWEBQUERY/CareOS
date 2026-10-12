import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import {
  SERVICES,
  SITE_STATUS,
  unitPlaces,
  type OrganizationStructure,
  type OrgSite,
  type OrgUnit,
  type ServiceKey,
  type SiteStatus,
} from "@/lib/organization-shared";

// "Leitung · Organisation": sites and care units with their occupancy, staff and leads.

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));

export async function organizationStructure(ctx: ApiContext): Promise<OrganizationStructure> {
  const org = ctx.actor.organizationId;
  const [orgRows, siteRows, unitRows, people, staffRows] = await Promise.all([
    ctx.sql`SELECT id, name, COALESCE(legal_name, '') AS legal_name FROM carecore_organizations WHERE id = ${org}` as Promise<
      Row[]
    >,
    ctx.sql`
      SELECT si.*, mu.display_name AS manager_name,
        (SELECT COUNT(DISTINCT u.id) FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
          WHERE u.active AND u.archived_at IS NULL AND p.organization_id = ${org}
            AND (p.primary_care_unit_id IN (SELECT id FROM carecore_care_units WHERE site_id = si.id)
              OR EXISTS (SELECT 1 FROM carecore_user_unit_assignments a JOIN carecore_care_units cu ON cu.id = a.care_unit_id
                WHERE a.user_id = u.id AND cu.site_id = si.id AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)))) AS staff
      FROM carecore_sites si LEFT JOIN carecore_users mu ON mu.id = si.manager_user_id
      WHERE si.organization_id = ${org}
      ORDER BY si.status = 'archived', si.created_at, si.name` as Promise<Row[]>,
    ctx.sql`
      SELECT cu.*, si.name AS site_name, lu.display_name AS lead_name,
        COALESCE(rooms.rooms, 0) AS room_count, COALESCE(rooms.beds, 0) AS bed_count,
        (SELECT COUNT(*) FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
          WHERE st.care_unit_id = cu.id AND st.ended_at IS NULL AND r.status = 'active') AS occupied,
        (SELECT COUNT(DISTINCT u.id) FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
          WHERE u.active AND u.archived_at IS NULL AND p.organization_id = ${org}
            AND (p.primary_care_unit_id = cu.id OR EXISTS (
              SELECT 1 FROM carecore_user_unit_assignments a WHERE a.user_id = u.id AND a.care_unit_id = cu.id
                AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)))) AS staff
      FROM carecore_care_units cu
      JOIN carecore_sites si ON si.id = cu.site_id
      LEFT JOIN carecore_users lu ON lu.id = cu.lead_user_id
      LEFT JOIN LATERAL (SELECT COUNT(*) AS rooms, SUM(beds) AS beds FROM carecore_rooms
        WHERE care_unit_id = cu.id AND active) rooms ON TRUE
      WHERE si.organization_id = ${org}
      ORDER BY NOT cu.active, si.name, cu.name` as Promise<Row[]>,
    ctx.sql`
      SELECT u.id, u.display_name, COALESCE(p.job_title, '') AS job_title
      FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
      WHERE p.organization_id = ${org} AND u.active AND u.archived_at IS NULL
      ORDER BY u.display_name` as Promise<Row[]>,
    ctx.sql`
      SELECT COUNT(*) AS staff, COUNT(DISTINCT u.role) AS roles,
        COUNT(*) FILTER (WHERE p.primary_care_unit_id IS NULL AND NOT EXISTS (
          SELECT 1 FROM carecore_user_unit_assignments a WHERE a.user_id = u.id)) AS unassigned
      FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
      WHERE p.organization_id = ${org} AND u.active AND u.archived_at IS NULL` as Promise<Row[]>,
  ]);
  if (!orgRows[0]) throw new ApiError("Organisation nicht gefunden.", 404);

  const sites: OrgSite[] = siteRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    code: str(row.code),
    siteType: str(row.site_type),
    country: str(row.country),
    addressLine1: str(row.address_line1),
    postalCode: str(row.postal_code),
    city: str(row.city),
    phone: str(row.phone),
    email: str(row.email),
    status: (row.status as SiteStatus) ?? "active",
    managerId: row.manager_user_id ? String(row.manager_user_id) : null,
    managerName: row.manager_name ? String(row.manager_name) : null,
    notes: str(row.notes),
    staff: Number(row.staff),
  }));
  const units: OrgUnit[] = unitRows.map((row) => ({
    id: String(row.id),
    siteId: String(row.site_id),
    siteName: String(row.site_name),
    name: String(row.name),
    code: str(row.code),
    floor: str(row.floor),
    capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
    specialty: str(row.specialty),
    services: (Array.isArray(row.services) ? row.services : []).filter(
      (key): key is ServiceKey => typeof key === "string" && key in SERVICES,
    ),
    notes: str(row.notes),
    active: Boolean(row.active),
    leadId: row.lead_user_id ? String(row.lead_user_id) : null,
    leadName: row.lead_name ? String(row.lead_name) : null,
    rooms: Number(row.room_count),
    beds: Number(row.bed_count),
    occupied: Number(row.occupied),
    staff: Number(row.staff),
    updatedAt: iso(row.updated_at),
  }));
  const active = units.filter((unit) => unit.active);
  const staff = staffRows[0] ?? {};
  return {
    organization: { id: org, name: String(orgRows[0].name), legalName: String(orgRows[0].legal_name) },
    sites,
    units,
    people: people.map((row) => ({
      id: String(row.id),
      name: String(row.display_name),
      jobTitle: String(row.job_title),
    })),
    totals: {
      sites: sites.filter((site) => site.status !== "archived").length,
      units: active.length,
      places: active.reduce((sum, unit) => sum + unitPlaces(unit), 0),
      occupied: active.reduce((sum, unit) => sum + unit.occupied, 0),
      staff: Number(staff.staff ?? 0),
      roles: Number(staff.roles ?? 0),
      unassignedStaff: Number(staff.unassigned ?? 0),
      unitsWithoutLead: active.filter((unit) => !unit.leadId).length,
    },
  };
}

async function assertPerson(ctx: ApiContext, value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const id = assertUuid(value, "Leitung");
  const rows = await ctx.sql`
    SELECT u.id FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE u.id = ${id} AND p.organization_id = ${ctx.actor.organizationId} AND u.active AND u.archived_at IS NULL`;
  if (!rows[0]) throw new ApiError("Die gewählte Leitung ist nicht aktiv.");
  return id;
}

async function assertSite(ctx: ApiContext, value: unknown) {
  const id = assertUuid(value, "Standort");
  const rows =
    await ctx.sql`SELECT * FROM carecore_sites WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0]) throw new ApiError("Standort nicht gefunden.", 404);
  return rows[0] as Row;
}

async function assertUnit(ctx: ApiContext, value: unknown) {
  const id = assertUuid(value, "Wohnbereich");
  const rows = await ctx.sql`
    SELECT cu.* FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
    WHERE cu.id = ${id} AND si.organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  return rows[0] as Row;
}

const uniqueViolation = (error: unknown) => (error as { code?: string })?.code === "23505";

function siteInput(body: Record<string, unknown>) {
  const name = text(body.name, 180);
  if (!name) throw new ApiError("Bitte einen Standortnamen angeben.");
  const status = String(body.status ?? "active");
  if (!(status in SITE_STATUS)) throw new ApiError("Status ist ungültig.");
  return {
    name,
    code: text(body.code, 12).toUpperCase() || null,
    siteType: text(body.siteType, 60) || null,
    country: text(body.country, 60) || null,
    addressLine1: text(body.addressLine1, 180) || null,
    postalCode: text(body.postalCode, 20) || null,
    city: text(body.city, 120) || null,
    phone: text(body.phone, 60) || null,
    email: text(body.email, 160) || null,
    status: status as SiteStatus,
    notes: text(body.notes, 2000) || null,
  };
}

export async function saveSite(ctx: ApiContext, siteId: string | null, body: Record<string, unknown>) {
  const input = siteInput(body);
  const managerId = await assertPerson(ctx, body.managerId);
  const before = siteId ? await assertSite(ctx, siteId) : null;
  const id = siteId ?? randomUUID();
  try {
    await ctx.sql.transaction([
      before
        ? ctx.sql`
        UPDATE carecore_sites SET name = ${input.name}, code = ${input.code}, site_type = ${input.siteType},
          country = ${input.country}, address_line1 = ${input.addressLine1}, postal_code = ${input.postalCode},
          city = ${input.city}, phone = ${input.phone}, email = ${input.email}, status = ${input.status},
          active = ${input.status !== "archived"}, manager_user_id = ${managerId}, notes = ${input.notes}, updated_at = NOW()
        WHERE id = ${id}`
        : ctx.sql`
        INSERT INTO carecore_sites (id, organization_id, name, code, site_type, country, address_line1, postal_code, city,
          phone, email, status, active, manager_user_id, notes)
        VALUES (${id}, ${ctx.actor.organizationId}, ${input.name}, ${input.code}, ${input.siteType}, ${input.country},
          ${input.addressLine1}, ${input.postalCode}, ${input.city}, ${input.phone}, ${input.email}, ${input.status},
          ${input.status !== "archived"}, ${managerId}, ${input.notes})`,
      auditStatement(ctx, "site", id, before ? "update" : "create", before, { ...input, managerId }),
    ]);
  } catch (error) {
    if (uniqueViolation(error)) throw new ApiError("Ein Standort mit diesem Namen existiert bereits.", 409);
    throw error;
  }
  return id;
}

function unitInput(body: Record<string, unknown>) {
  const name = text(body.name, 160);
  if (!name) throw new ApiError("Bitte eine Bezeichnung angeben.");
  const capacity =
    body.capacity === "" || body.capacity === null || body.capacity === undefined ? null : Number(body.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0 || capacity > 500))
    throw new ApiError("Die Kapazität muss zwischen 0 und 500 liegen.");
  const services = Array.isArray(body.services)
    ? [...new Set(body.services.filter((key): key is ServiceKey => typeof key === "string" && key in SERVICES))]
    : [];
  return {
    name,
    code: text(body.code, 32).toUpperCase() || null,
    floor: text(body.floor, 80) || null,
    capacity,
    specialty: text(body.specialty, 120) || null,
    services,
    notes: text(body.notes, 2000) || null,
    active: body.active === undefined ? true : Boolean(body.active),
  };
}

export async function saveUnit(ctx: ApiContext, unitId: string | null, body: Record<string, unknown>) {
  const input = unitInput(body);
  const leadId = await assertPerson(ctx, body.leadId);
  const before = unitId ? await assertUnit(ctx, unitId) : null;
  const siteId = body.siteId ? String((await assertSite(ctx, body.siteId)).id) : before ? String(before.site_id) : null;
  const fallbackSite = siteId
    ? null
    : (
        (await ctx.sql`SELECT id FROM carecore_sites WHERE organization_id = ${ctx.actor.organizationId} AND status <> 'archived'
        ORDER BY created_at LIMIT 1`) as Row[]
      )[0];
  const site = siteId ?? (fallbackSite ? String(fallbackSite.id) : null);
  if (!site) throw new ApiError("Bitte zuerst einen Standort anlegen.");
  if (before && !input.active) {
    const occupied = await ctx.sql`
      SELECT 1 FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
      WHERE st.care_unit_id = ${unitId} AND st.ended_at IS NULL AND r.status = 'active' LIMIT 1`;
    if (occupied[0]) throw new ApiError("Der Wohnbereich ist noch belegt und kann nicht deaktiviert werden.", 409);
  }
  const id = unitId ?? randomUUID();
  const services = JSON.stringify(input.services);
  try {
    await ctx.sql.transaction([
      before
        ? ctx.sql`
        UPDATE carecore_care_units SET site_id = ${site}, name = ${input.name}, code = ${input.code}, floor = ${input.floor},
          capacity = ${input.capacity}, specialty = ${input.specialty}, services = ${services}::jsonb, notes = ${input.notes},
          active = ${input.active}, lead_user_id = ${leadId}, updated_at = NOW()
        WHERE id = ${id}`
        : ctx.sql`
        INSERT INTO carecore_care_units (id, site_id, name, code, floor, capacity, specialty, services, notes, active, lead_user_id)
        VALUES (${id}, ${site}, ${input.name}, ${input.code}, ${input.floor}, ${input.capacity}, ${input.specialty},
          ${services}::jsonb, ${input.notes}, ${input.active}, ${leadId})`,
      auditStatement(ctx, "care_unit", id, before ? "update" : "create", before, { ...input, siteId: site, leadId }),
    ]);
  } catch (error) {
    if (uniqueViolation(error)) throw new ApiError("Ein Wohnbereich mit dieser Bezeichnung existiert bereits.", 409);
    throw error;
  }
  return id;
}
