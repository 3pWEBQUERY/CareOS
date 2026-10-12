import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  type OccupancyOverview,
  type OccupancyRoom,
  type OccupancyUnit,
  type WaitlistEntry,
  type WaitlistStatus,
} from "@/lib/occupancy-shared";

// Belegung und Eintritt: freie Plätze je Wohnbereich, geplante Eintritte und Warteliste. Rein organisatorisch; der Bedarf
// steht so in der Notiz, wie er mitgeteilt wurde – CareOS stuft nicht ein und ordnet keine Reihenfolge vor.

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

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "residents.write")) throw new ApiError("Keine Berechtigung.", 403);
}

async function today(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT (NOW() AT TIME ZONE timezone)::date::text AS today FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(rows[0]?.today);
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

const entry = (row: Row): WaitlistEntry => ({
  id: String(row.id),
  firstName: String(row.first_name),
  lastName: String(row.last_name),
  dateOfBirth: (row.date_of_birth as string | null) ?? null,
  contactName: String(row.contact_name ?? ""),
  contactPhone: String(row.contact_phone ?? ""),
  contactEmail: String(row.contact_email ?? ""),
  desiredCareUnitId: (row.desired_care_unit_id as string | null) ?? null,
  desiredCareUnit: (row.desired_care_unit as string | null) ?? null,
  desiredFrom: (row.desired_from as string | null) ?? null,
  registeredOn: String(row.registered_on),
  note: String(row.note ?? ""),
  status: row.status as WaitlistStatus,
  statusNote: String(row.status_note ?? ""),
  residentId: (row.resident_id as string | null) ?? null,
});

export async function occupancyOverview(ctx: ApiContext): Promise<OccupancyOverview> {
  const org = ctx.actor.organizationId;
  const [units, rooms, occupants, planned, waitlist] = (await Promise.all([
    ctx.sql`
      SELECT cu.id, cu.name, cu.capacity FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE s.organization_id = ${org} AND cu.active ORDER BY cu.name`,
    ctx.sql`
      SELECT ro.id, ro.name, ro.beds, ro.active, ro.care_unit_id FROM carecore_rooms ro
      JOIN carecore_care_units cu ON cu.id = ro.care_unit_id JOIN carecore_sites s ON s.id = cu.site_id
      WHERE s.organization_id = ${org} AND cu.active ORDER BY ro.name`,
    ctx.sql`
      SELECT r.id, r.first_name || ' ' || r.last_name AS name, r.status, st.room_id, st.care_unit_id
      FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
      WHERE r.organization_id = ${org} AND st.ended_at IS NULL AND r.status IN ('active', 'transferred', 'planned')
      ORDER BY r.last_name, r.first_name`,
    ctx.sql`
      SELECT r.id, r.first_name || ' ' || r.last_name AS name, r.date_of_birth::text AS date_of_birth,
        r.admitted_on::text AS admitted_on, st.care_unit_id, COALESCE(cu.name, '') AS care_unit, COALESCE(ro.name, '') AS room,
        (SELECT w.id FROM carecore_waitlist_entries w WHERE w.resident_id = r.id LIMIT 1) AS waitlist_id
      FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) st ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
      WHERE r.organization_id = ${org} AND r.status = 'planned'
      ORDER BY r.admitted_on NULLS LAST, r.last_name`,
    ctx.sql`
      SELECT w.*, w.date_of_birth::text AS date_of_birth, w.desired_from::text AS desired_from,
        w.registered_on::text AS registered_on, cu.name AS desired_care_unit
      FROM carecore_waitlist_entries w LEFT JOIN carecore_care_units cu ON cu.id = w.desired_care_unit_id
      WHERE w.organization_id = ${org}
        AND (w.status IN ('waiting', 'offered') OR w.updated_at > NOW() - INTERVAL '180 days')
      ORDER BY w.registered_on, w.created_at`,
  ])) as Row[][];

  const unitList: OccupancyUnit[] = units.map((unit) => {
    const own = rooms.filter((room) => room.care_unit_id === unit.id);
    const roomList: OccupancyRoom[] = own.map((room) => ({
      id: String(room.id),
      name: String(room.name),
      beds: Number(room.beds),
      active: Boolean(room.active),
      occupants: occupants
        .filter((person) => person.room_id === room.id)
        .map((person) => ({
          id: String(person.id),
          name: String(person.name),
          status: person.status as "active" | "transferred" | "planned",
        })),
    }));
    const inUnit = occupants.filter((person) => person.care_unit_id === unit.id);
    const beds = roomList.filter((room) => room.active).reduce((sum, room) => sum + room.beds, 0);
    const places = unit.capacity === null || unit.capacity === undefined ? beds : Number(unit.capacity);
    const occupied = inUnit.filter((person) => person.status !== "planned").length;
    const reserved = inUnit.filter((person) => person.status === "planned").length;
    return {
      id: String(unit.id),
      name: String(unit.name),
      places,
      beds,
      occupied,
      reserved,
      free: Math.max(0, places - occupied - reserved),
      rooms: roomList,
    };
  });
  const sum = (key: "places" | "occupied" | "reserved" | "free") =>
    unitList.reduce((total, unit) => total + unit[key], 0);
  const list = waitlist.map(entry);
  return {
    today: await today(ctx),
    canWrite: hasPermission(ctx.actor, "residents.write"),
    canManageRooms: hasPermission(ctx.actor, "administration.manage"),
    totals: { places: sum("places"), occupied: sum("occupied"), reserved: sum("reserved"), free: sum("free") },
    units: unitList,
    planned: planned.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      dateOfBirth: (row.date_of_birth as string | null) ?? null,
      admittedOn: (row.admitted_on as string | null) ?? null,
      careUnitId: (row.care_unit_id as string | null) ?? null,
      careUnit: String(row.care_unit),
      room: String(row.room),
      waitlistId: (row.waitlist_id as string | null) ?? null,
    })),
    waitlist: list.filter((item) => item.status === "waiting" || item.status === "offered"),
    closed: list.filter((item) => item.status === "admitted" || item.status === "withdrawn"),
  };
}

function waitlistInput(body: Record<string, unknown>) {
  const firstName = text(body.firstName, 100);
  const lastName = text(body.lastName, 100);
  if (!firstName || !lastName) throw new ApiError("Bitte Vor- und Nachname angeben.");
  return {
    firstName,
    lastName,
    dateOfBirth: date(body.dateOfBirth, "Geburtsdatum", false),
    contactName: text(body.contactName, 160),
    contactPhone: text(body.contactPhone, 60),
    contactEmail: text(body.contactEmail, 200),
    desiredFrom: date(body.desiredFrom, "Gewünschter Eintritt", false),
    registeredOn: date(body.registeredOn, "Angemeldet am", true),
    note: text(body.note, 4000),
  };
}

async function loadEntry(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Eintrag");
  const rows = (await ctx.sql`
    SELECT w.*, w.date_of_birth::text AS date_of_birth FROM carecore_waitlist_entries w
    WHERE w.id = ${id} AND w.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Eintrag auf der Warteliste nicht gefunden.", 404);
  return rows[0];
}

export async function saveWaitlistEntry(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const input = waitlistInput(body);
  const careUnitId = await assertCareUnit(ctx, body.desiredCareUnitId);
  if (input.registeredOn > (await today(ctx))) throw new ApiError("Die Anmeldung liegt in der Zukunft.");
  // Ohne Namen im Protokoll: Interessentinnen und Interessenten sind (noch) keine Personen der Einrichtung.
  const logged = { careUnitId, desiredFrom: input.desiredFrom, registeredOn: input.registeredOn };
  if (!idInput) {
    const id = randomUUID();
    await ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_waitlist_entries (id, organization_id, first_name, last_name, date_of_birth, contact_name,
          contact_phone, contact_email, desired_care_unit_id, desired_from, registered_on, note, created_by, updated_by)
        VALUES (${id}, ${ctx.actor.organizationId}, ${input.firstName}, ${input.lastName}, ${input.dateOfBirth}::date,
          ${input.contactName}, ${input.contactPhone}, ${input.contactEmail}, ${careUnitId}, ${input.desiredFrom}::date,
          ${input.registeredOn}::date, ${input.note}, ${ctx.actor.id}, ${ctx.actor.id})`,
      auditStatement(ctx, "waitlist_entry", id, "created", null, logged),
    ]);
    return { id };
  }
  const before = await loadEntry(ctx, idInput);
  if (before.status === "admitted" || before.status === "withdrawn")
    throw new ApiError("Der Eintrag ist abgeschlossen.", 409);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_waitlist_entries SET first_name = ${input.firstName}, last_name = ${input.lastName},
        date_of_birth = ${input.dateOfBirth}::date, contact_name = ${input.contactName}, contact_phone = ${input.contactPhone},
        contact_email = ${input.contactEmail}, desired_care_unit_id = ${careUnitId}, desired_from = ${input.desiredFrom}::date,
        registered_on = ${input.registeredOn}::date, note = ${input.note}, updated_by = ${ctx.actor.id}, updated_at = NOW()
      WHERE id = ${before.id}`,
    auditStatement(ctx, "waitlist_entry", String(before.id), "updated", null, logged),
  ]);
  return { id: String(before.id) };
}

// Status: wartet, Platz angeboten oder zurückgezogen (mit Grund). Übernommen wird nur über „Eintritt planen“.
export async function setWaitlistStatus(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await loadEntry(ctx, idInput);
  const status = String(body.status ?? "") as WaitlistStatus;
  if (!["waiting", "offered", "withdrawn"].includes(status)) throw new ApiError("Status ist ungültig.");
  if (before.status === "admitted" || before.status === "withdrawn")
    throw new ApiError("Der Eintrag ist abgeschlossen.", 409);
  const note = text(body.note, 2000);
  if (status === "withdrawn" && !note) throw new ApiError("Bitte einen Grund angeben.");
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_waitlist_entries SET status = ${status}, status_note = ${note}, updated_by = ${ctx.actor.id},
        updated_at = NOW()
      WHERE id = ${before.id}`,
    auditStatement(
      ctx,
      "waitlist_entry",
      String(before.id),
      `status_${status}`,
      { status: before.status },
      { status, note },
    ),
  ]);
}

// Eintritt planen: aus dem Wartelisten-Eintrag wird eine Person mit Status „Eintritt geplant“ im gewählten Zimmer.
export async function planAdmission(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await loadEntry(ctx, idInput);
  if (before.status === "admitted" || before.status === "withdrawn")
    throw new ApiError("Der Eintrag ist abgeschlossen.", 409);
  const admittedOn = date(body.admittedOn, "Eintrittsdatum", true);
  if (admittedOn < (await today(ctx))) throw new ApiError("Das Eintrittsdatum liegt in der Vergangenheit.");
  const roomId = assertUuid(body.roomId, "Zimmer");
  const rooms = (await ctx.sql`
    SELECT ro.id, ro.care_unit_id, ro.name FROM carecore_rooms ro
    JOIN carecore_care_units cu ON cu.id = ro.care_unit_id JOIN carecore_sites s ON s.id = cu.site_id
    WHERE ro.id = ${roomId} AND s.organization_id = ${ctx.actor.organizationId} AND ro.active AND cu.active`) as Row[];
  const room = rooms[0];
  if (!room) throw new ApiError("Zimmer nicht gefunden.", 404);
  const residentId = randomUUID();
  const name = `${before.first_name} ${before.last_name}`;
  try {
    await ctx.sql.transaction([
      // Nur mit freiem Bett (aktive, verlegte und geplante Personen belegen es); gleichzeitig vergeben: Abbruch.
      ctx.sql`
        SELECT carecore_assert(
          (SELECT beds FROM carecore_rooms WHERE id = ${roomId}) > (SELECT COUNT(*) FROM carecore_resident_stays st
            JOIN carecore_residents r ON r.id = st.resident_id
            WHERE st.room_id = ${roomId} AND st.ended_at IS NULL AND r.status IN ('active', 'transferred', 'planned')),
          'ROOM_FULL')`,
      ctx.sql`
        INSERT INTO carecore_residents (id, organization_id, first_name, last_name, date_of_birth, gender, status, admitted_on,
          notes)
        VALUES (${residentId}, ${ctx.actor.organizationId}, ${before.first_name}, ${before.last_name},
          ${before.date_of_birth}::date, 'unspecified', 'planned', ${admittedOn}::date, ${String(before.note || "") || null})`,
      ctx.sql`
        INSERT INTO carecore_resident_stays (id, resident_id, care_unit_id, room_id, started_at, created_by)
        VALUES (${randomUUID()}, ${residentId}, ${room.care_unit_id}, ${roomId},
          ${new Date(`${admittedOn}T12:00:00Z`).toISOString()}, ${ctx.actor.id})`,
      ctx.sql`
        WITH changed AS (UPDATE carecore_waitlist_entries SET status = 'admitted', resident_id = ${residentId},
          status_note = '', updated_by = ${ctx.actor.id}, updated_at = NOW()
        WHERE id = ${before.id} AND status IN ('waiting', 'offered') RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'WAITLIST_CLOSED')`,
      auditStatement(ctx, "waitlist_entry", String(before.id), "admitted", { status: before.status }, { residentId }),
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "resident",
        entityId: residentId,
        action: "admission_planned",
        after: { name, careUnitId: room.care_unit_id, room: room.name, admittedOn },
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("ROOM_FULL"))
      throw new ApiError("In diesem Zimmer ist kein Bett mehr frei.", 409);
    if (error instanceof Error && error.message.includes("WAITLIST_CLOSED"))
      throw new ApiError("Der Eintrag ist abgeschlossen.", 409);
    throw error;
  }
  return { residentId };
}

async function plannedResident(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Person");
  const rows = (await ctx.sql`
    SELECT id, status, admitted_on::text AS admitted_on, first_name || ' ' || last_name AS name FROM carecore_residents
    WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Person nicht gefunden.", 404);
  if (rows[0].status !== "planned") throw new ApiError("Für diese Person ist kein Eintritt geplant.", 409);
  return rows[0];
}

async function guarded(write: Promise<unknown>) {
  try {
    await write;
  } catch (error) {
    if (error instanceof Error && error.message.includes("NOT_PLANNED"))
      throw new ApiError("Für diese Person ist kein Eintritt geplant.", 409);
    throw error;
  }
}

// Eintritt bestätigen: die Person ist eingetreten (Datum heute oder früher) und erscheint in allen Listen.
export async function confirmAdmission(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await plannedResident(ctx, idInput);
  const admittedOn = date(body.admittedOn, "Eintrittsdatum", true);
  if (admittedOn > (await today(ctx))) throw new ApiError("Der Eintritt kann erst am Eintrittstag bestätigt werden.");
  const id = String(before.id);
  await guarded(
    ctx.sql.transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_residents SET status = 'active', admitted_on = ${admittedOn}::date, updated_at = NOW()
        WHERE id = ${id} AND status = 'planned' RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'NOT_PLANNED')`,
      ctx.sql`
        UPDATE carecore_resident_stays SET started_at = ${new Date(`${admittedOn}T12:00:00Z`).toISOString()}
        WHERE resident_id = ${id} AND ended_at IS NULL`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: id,
        entityType: "resident",
        entityId: id,
        action: "admission_confirmed",
        before: { admittedOn: before.admitted_on },
        after: { name: before.name, admittedOn },
      }),
    ]),
  );
}

// Geplanten Eintritt absagen (mit Grund): das Bett wird frei, ein Wartelisten-Eintrag wartet wieder.
export async function cancelAdmission(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const before = await plannedResident(ctx, idInput);
  const reason = text(body.reason, 2000);
  if (!reason) throw new ApiError("Bitte einen Grund angeben.");
  const id = String(before.id);
  await guarded(
    ctx.sql.transaction([
      ctx.sql`
        WITH changed AS (UPDATE carecore_residents SET status = 'archived', updated_at = NOW()
        WHERE id = ${id} AND status = 'planned' RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'NOT_PLANNED')`,
      ctx.sql`
        UPDATE carecore_resident_stays SET started_at = LEAST(started_at, NOW()), ended_at = NOW()
        WHERE resident_id = ${id} AND ended_at IS NULL`,
      ctx.sql`
        UPDATE carecore_waitlist_entries SET status = 'waiting', resident_id = NULL,
          status_note = ${`Eintritt abgesagt: ${reason}`}, updated_by = ${ctx.actor.id}, updated_at = NOW()
        WHERE resident_id = ${id}`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: id,
        entityType: "resident",
        entityId: id,
        action: "admission_cancelled",
        after: { name: before.name, reason },
      }),
    ]),
  );
}

// Zimmer anlegen oder ändern (Administration); Betten nie unter die aktuelle Belegung.
export async function saveRoom(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  if (!hasPermission(ctx.actor, "administration.manage")) throw new ApiError("Keine Berechtigung.", 403);
  const name = text(body.name, 80);
  if (!name) throw new ApiError("Bitte das Zimmer bezeichnen.");
  const beds = Number(body.beds);
  if (!Number.isInteger(beds) || beds < 1 || beds > 20) throw new ApiError("Betten: 1 bis 20.");
  const active = body.active !== false;
  if (!idInput) {
    const careUnitId = await assertCareUnit(ctx, body.careUnitId);
    if (!careUnitId) throw new ApiError("Bitte den Wohnbereich wählen.");
    const id = randomUUID();
    try {
      await ctx.sql.transaction([
        ctx.sql`
          INSERT INTO carecore_rooms (id, care_unit_id, name, room_number, beds, active)
          VALUES (${id}, ${careUnitId}, ${name}, ${name.replace(/\D/g, "") || null}, ${beds}, ${active})`,
        auditStatement(ctx, "room", id, "created", null, { name, beds, careUnitId, active }),
      ]);
    } catch (error) {
      if (String(error).includes("carecore_rooms_care_unit_id_name_key"))
        throw new ApiError("Dieses Zimmer gibt es im Wohnbereich bereits.", 409);
      throw error;
    }
    return { id };
  }
  const id = assertUuid(idInput, "Zimmer");
  const rows = (await ctx.sql`
    SELECT ro.*, (SELECT COUNT(*)::int FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
      WHERE st.room_id = ro.id AND st.ended_at IS NULL AND r.status IN ('active', 'transferred', 'planned')) AS occupants
    FROM carecore_rooms ro JOIN carecore_care_units cu ON cu.id = ro.care_unit_id JOIN carecore_sites s ON s.id = cu.site_id
    WHERE ro.id = ${id} AND s.organization_id = ${ctx.actor.organizationId}`) as Row[];
  const before = rows[0];
  if (!before) throw new ApiError("Zimmer nicht gefunden.", 404);
  const occupants = Number(before.occupants);
  if (beds < occupants) throw new ApiError(`Im Zimmer sind ${occupants} Betten belegt oder reserviert.`);
  if (!active && occupants) throw new ApiError("Ein belegtes Zimmer kann nicht stillgelegt werden.");
  try {
    await ctx.sql.transaction([
      ctx.sql`
        UPDATE carecore_rooms SET name = ${name}, beds = ${beds}, active = ${active}, updated_at = NOW() WHERE id = ${id}`,
      auditStatement(
        ctx,
        "room",
        id,
        "updated",
        { name: before.name, beds: Number(before.beds), active: Boolean(before.active) },
        { name, beds, active },
      ),
    ]);
  } catch (error) {
    if (String(error).includes("carecore_rooms_care_unit_id_name_key"))
      throw new ApiError("Dieses Zimmer gibt es im Wohnbereich bereits.", 409);
    throw error;
  }
  return { id };
}

// QR-Code am Zimmer: wer aktuell im Zimmer wohnt (aktiv oder verlegt, Platz reserviert). Die Seite öffnet bei genau
// einer anwesenden Person direkt deren Akte, sonst zeigt sie die Auswahl.
export async function roomResidents(ctx: ApiContext, roomInput: unknown) {
  const roomId = assertUuid(roomInput, "Zimmer");
  const rooms = (await ctx.sql`
    SELECT ro.id, ro.name, cu.name AS care_unit FROM carecore_rooms ro
    JOIN carecore_care_units cu ON cu.id = ro.care_unit_id JOIN carecore_sites s ON s.id = cu.site_id
    WHERE ro.id = ${roomId} AND s.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rooms[0]) throw new ApiError("Zimmer nicht gefunden.", 404);
  const residents = (await ctx.sql`
    SELECT r.id, r.first_name || ' ' || r.last_name AS name, r.status FROM carecore_resident_stays st
    JOIN carecore_residents r ON r.id = st.resident_id
    WHERE st.room_id = ${roomId} AND st.ended_at IS NULL AND r.organization_id = ${ctx.actor.organizationId}
      AND r.status IN ('active', 'transferred')
    ORDER BY r.last_name, r.first_name`) as Row[];
  return {
    room: { id: roomId, name: String(rooms[0].name), careUnit: String(rooms[0].care_unit) },
    residents: residents.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      status: row.status as "active" | "transferred",
    })),
  };
}
