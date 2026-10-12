import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import {
  VACCINATION_PLACES,
  type Vaccination,
  type VaccinationList,
  type VaccinationOverview,
  type VaccinationPlace,
} from "@/lib/vaccinations-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertWrite(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "residents.write")) throw new ApiError("Keine Berechtigung.", 403);
}

async function today(ctx: ApiContext) {
  const [row] = (await ctx.sql`
    SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS day FROM carecore_organizations
    WHERE id = ${ctx.actor.organizationId}`) as Row[];
  return String(row.day);
}

// Bezeichnungen „Impfung gegen“, die die Einrichtung schon verwendet hat (häufigste zuerst).
async function knownTargets(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT MIN(target) AS target FROM carecore_vaccinations WHERE organization_id = ${ctx.actor.organizationId}
    GROUP BY lower(target) ORDER BY COUNT(*) DESC, MIN(target) LIMIT 30`) as Row[];
  return rows.map((row) => String(row.target));
}

export async function vaccinationList(ctx: ApiContext, residentInput: unknown): Promise<VaccinationList> {
  const residentId = await assertResident(ctx, residentInput);
  const [rows, targets] = await Promise.all([
    ctx.sql`
      SELECT v.*, to_char(v.given_on, 'YYYY-MM-DD') AS given_day, u.display_name AS recorded_by
      FROM carecore_vaccinations v LEFT JOIN carecore_users u ON u.id = v.created_by
      WHERE v.resident_id = ${residentId} ORDER BY v.given_on DESC, v.created_at DESC` as Promise<Row[]>,
    knownTargets(ctx),
  ]);
  return {
    residentId,
    canWrite: hasPermission(ctx.actor, "residents.write"),
    targets,
    vaccinations: rows.map((row): Vaccination => ({
      id: String(row.id),
      givenOn: String(row.given_day),
      target: String(row.target),
      vaccine: String(row.vaccine),
      lot: String(row.lot),
      place: row.place as VaccinationPlace,
      givenBy: String(row.given_by),
      note: String(row.note),
      recordedBy: (row.recorded_by as string | null) ?? null,
    })),
  };
}

export async function createVaccination(ctx: ApiContext, residentInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const residentId = await assertResident(ctx, residentInput);
  const givenOn = typeof body.givenOn === "string" && DATE.test(body.givenOn) ? body.givenOn : null;
  if (!givenOn) throw new ApiError("Bitte das Datum der Impfung angeben.");
  if (givenOn > (await today(ctx))) throw new ApiError("Das Datum der Impfung liegt in der Zukunft.");
  const target = text(body.target, 120);
  if (!target) throw new ApiError("Bitte angeben, wogegen geimpft wurde.");
  const place = String(body.place ?? "inhouse");
  if (!(place in VACCINATION_PLACES)) throw new ApiError("Bitte „im Haus“ oder „extern“ wählen.");
  const data = {
    givenOn,
    target,
    vaccine: text(body.vaccine, 200),
    lot: text(body.lot, 60),
    place: place as VaccinationPlace,
    givenBy: text(body.givenBy, 200),
    note: text(body.note, 2000),
  };
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_vaccinations (id, organization_id, resident_id, given_on, target, vaccine, lot, place, given_by,
        note, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${data.givenOn}, ${data.target}, ${data.vaccine},
        ${data.lot}, ${data.place}, ${data.givenBy}, ${data.note}, ${ctx.actor.id})`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "vaccination",
      entityId: id,
      action: "created",
      // „target“ heisst im Änderungsprotokoll bereits „Übersetzung“, daher „against“.
      after: {
        givenOn: data.givenOn,
        against: data.target,
        vaccine: data.vaccine,
        lot: data.lot,
        place: data.place,
        givenBy: data.givenBy,
        note: data.note,
      },
    }),
  ]);
  return vaccinationList(ctx, residentId);
}

// Entfernen nur für Fehleinträge, mit Begründung; die Angaben bleiben im Protokoll der Akte.
export async function deleteVaccination(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  assertWrite(ctx);
  const id = assertUuid(idInput, "Impfung");
  const reason = text(body.reason, 500);
  if (!reason) throw new ApiError("Bitte angeben, warum der Eintrag entfernt wird.");
  const [row] = (await ctx.sql`
    SELECT v.*, to_char(v.given_on, 'YYYY-MM-DD') AS given_day FROM carecore_vaccinations v
    WHERE v.id = ${id} AND v.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!row) throw new ApiError("Impfung nicht gefunden.", 404);
  const residentId = String(row.resident_id);
  await ctx.sql.transaction([
    ctx.sql`DELETE FROM carecore_vaccinations WHERE id = ${id}`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "vaccination",
      entityId: id,
      action: "deleted",
      before: { givenOn: row.given_day, against: row.target, vaccine: row.vaccine, lot: row.lot },
      after: { reason },
    }),
  ]);
  return vaccinationList(ctx, residentId);
}

// Übersicht je Wohnbereich: alle Personen mit laufendem Aufenthalt und ihre letzte Impfung gegen „target“, auf Wunsch nur
// seit „since“ (beides frei gewählt; ohne Auswahl die am häufigsten verwendete Bezeichnung und kein Zeitraum).
export async function vaccinationOverview(
  ctx: ApiContext,
  query: { target?: string | null; since?: string | null },
): Promise<VaccinationOverview> {
  const targets = await knownTargets(ctx);
  const target = text(query.target, 120) || targets[0] || "";
  const day = await today(ctx);
  const since = query.since && DATE.test(query.since) ? query.since : null;
  if (since && since > day) throw new ApiError("Das Datum „seit“ liegt in der Zukunft.");
  const org = ctx.actor.organizationId;
  const [units, rows] = (await Promise.all([
    ctx.sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE s.organization_id = ${org} AND cu.active ORDER BY cu.name`,
    ctx.sql`
      SELECT r.id, r.last_name || ' ' || r.first_name AS name, COALESCE(ro.name, '') AS room, st.care_unit_id,
        (SELECT to_char(MAX(v.given_on), 'YYYY-MM-DD') FROM carecore_vaccinations v
          WHERE v.resident_id = r.id AND lower(v.target) = lower(${target}) AND (${since}::date IS NULL OR v.given_on >= ${since}::date)) AS last_given
      FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
      LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
      WHERE r.organization_id = ${org} AND st.ended_at IS NULL AND r.status = 'active'
      ORDER BY ro.name NULLS LAST, r.last_name, r.first_name`,
  ])) as Row[][];
  return {
    target,
    since,
    targets,
    units: units
      .map((unit) => ({
        id: String(unit.id),
        name: String(unit.name),
        residents: rows
          .filter((row) => row.care_unit_id === unit.id)
          .map((row) => ({
            id: String(row.id),
            name: String(row.name),
            room: String(row.room),
            lastGivenOn: (row.last_given as string | null) ?? null,
          })),
      }))
      .filter((unit) => unit.residents.length > 0),
  };
}
