import { ApiError, iso, type ApiContext, type Row } from "@/lib/api-context";
import { ISOLATION_KINDS, type IsolationKind } from "@/lib/hygiene-shared";
import {
  EVACUATION_MOBILITY_KEYS,
  type EvacuationList,
  type EvacuationMobility,
  type EvacuationUnit,
} from "@/lib/evacuation-shared";
import type { ResuscitationStatus } from "@/lib/resident-record-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Liste für Brandfall und Evakuation: alle aktiven Wohnbereiche (oder einer), Zimmer in der Reihenfolge der Namen,
// darin die Personen mit laufendem Aufenthalt. Zimmer ohne Personen erscheinen nicht.
export async function evacuationList(ctx: ApiContext, unitInput: unknown): Promise<EvacuationList> {
  const unitId = unitInput === null || unitInput === undefined || unitInput === "" ? null : String(unitInput);
  if (unitId && !UUID.test(unitId)) throw new ApiError("Wohnbereich ist ungültig.");
  const org = ctx.actor.organizationId;
  const [units, people, organization] = (await Promise.all([
    ctx.sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE s.organization_id = ${org} AND cu.active AND (${unitId}::uuid IS NULL OR cu.id = ${unitId}::uuid)
      ORDER BY cu.name`,
    ctx.sql`
      SELECT r.id, r.first_name, r.last_name, r.status, r.evacuation_mobility, COALESCE(r.evacuation_note, '') AS note,
        r.resuscitation_status, st.care_unit_id, ro.id AS room_id, ro.name AS room,
        (SELECT i.kind FROM carecore_isolation_measures i WHERE i.resident_id = r.id AND i.ended_at IS NULL
          AND i.starts_at <= NOW() ORDER BY i.starts_at DESC LIMIT 1) AS isolation
      FROM carecore_resident_stays st
      JOIN carecore_residents r ON r.id = st.resident_id
      LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
      WHERE r.organization_id = ${org} AND st.ended_at IS NULL AND r.status IN ('active', 'transferred')
      ORDER BY ro.name NULLS LAST, r.last_name, r.first_name`,
    ctx.sql`SELECT name, NOW() AS now FROM carecore_organizations WHERE id = ${org}`,
  ])) as Row[][];
  if (unitId && !units[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  const list: EvacuationUnit[] = units.map((unit) => {
    const counts = Object.fromEntries(
      [...EVACUATION_MOBILITY_KEYS, "unknown", "absent"].map((key) => [key, 0]),
    ) as EvacuationUnit["counts"];
    const rooms = new Map<string, EvacuationUnit["rooms"][number]>();
    for (const row of people.filter((person) => person.care_unit_id === unit.id)) {
      const key = row.room_id ? String(row.room_id) : "";
      if (!rooms.has(key))
        rooms.set(key, {
          id: row.room_id ? String(row.room_id) : null,
          name: row.room ? String(row.room) : "Ohne Zimmer",
          people: [],
        });
      const absent = row.status === "transferred";
      const mobility = (row.evacuation_mobility as EvacuationMobility | null) ?? null;
      if (absent) counts.absent += 1;
      else counts[mobility ?? "unknown"] += 1;
      rooms.get(key)!.people.push({
        id: String(row.id),
        name: `${row.last_name} ${row.first_name}`,
        mobility,
        note: String(row.note),
        resuscitation: (row.resuscitation_status as ResuscitationStatus | null) ?? null,
        isolation: row.isolation ? ISOLATION_KINDS[row.isolation as IsolationKind] : null,
        absent,
      });
    }
    return { id: String(unit.id), name: String(unit.name), rooms: [...rooms.values()], counts };
  });
  return {
    generatedAt: iso(organization[0]?.now) ?? new Date().toISOString(),
    organization: String(organization[0]?.name ?? ""),
    units: list,
  };
}
