import { randomUUID } from "node:crypto";
import { diagnosisText } from "@/lib/diagnoses-shared";
import { ApiError, assertUuid, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import type { VisitGroup, VisitOverview } from "@/lib/visits-shared";

// Visite vorbereiten: offene Einträge „Für Visite“ gesammelt je Hausärztin bzw. Hausarzt. Die Rückmeldung wird als
// eigener Eintrag (Kategorie „Arztvisite“) dokumentiert und schliesst die Frage.

export async function visitOverview(ctx: ApiContext, careUnitInput: string | null): Promise<VisitOverview> {
  const careUnitId = careUnitInput ? assertUuid(careUnitInput, "Wohnbereich") : null;
  const org = ctx.actor.organizationId;
  const [open, resolved] = (await Promise.all([
    // Neueste Fassung je Eintrag: korrigierte Einträge erscheinen mit ihrer Korrektur.
    ctx.sql`
      SELECT d.id, d.category, d.body, d.occurred_at, COALESCE(u.display_name, 'Unbekannt') AS author,
        r.id AS resident_id, r.first_name || ' ' || r.last_name AS resident_name, COALESCE(ro.name, '') AS room,
        COALESCE(cu.name, '') AS care_unit, NULLIF(TRIM(r.gp_name), '') AS gp_name, r.gp_practice, r.gp_phone
      FROM carecore_documentation_entries d
      JOIN carecore_residents r ON r.id = d.resident_id AND r.organization_id = ${org} AND r.status = 'active'
      JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_users u ON u.id = d.author_user_id
      WHERE d.importance = 'visit'
        AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM carecore_documentation_entries fix WHERE fix.amended_from_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM carecore_visit_resolutions v
          WHERE v.entry_id IN (d.id, COALESCE(d.amended_from_id, d.id)))
      ORDER BY gp_name NULLS LAST, r.last_name, r.first_name, d.occurred_at`,
    ctx.sql`
      SELECT v.entry_id, v.physician, v.resolved_at, q.body AS question, a.body AS response,
        r.id AS resident_id, r.first_name || ' ' || r.last_name AS resident_name,
        COALESCE(u.display_name, pa.display_name || ' (Portal)', 'Unbekannt') AS resolved_by
      FROM carecore_visit_resolutions v
      JOIN carecore_documentation_entries q ON q.id = v.entry_id
      LEFT JOIN carecore_documentation_entries a ON a.id = v.response_entry_id
      JOIN carecore_residents r ON r.id = q.resident_id
      LEFT JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_users u ON u.id = v.resolved_by
      LEFT JOIN carecore_portal_accounts pa ON pa.id = v.resolved_by_portal_account_id
      WHERE v.organization_id = ${org} AND v.resolved_at > NOW() - INTERVAL '14 days'
        AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
      ORDER BY v.resolved_at DESC LIMIT 100`,
  ])) as Row[][];

  const groups: VisitGroup[] = [];
  for (const row of open) {
    const physician = row.gp_name
      ? {
          name: String(row.gp_name),
          practice: (row.gp_practice as string | null) || null,
          phone: (row.gp_phone as string | null) || null,
        }
      : null;
    let group = groups.find((item) => (item.physician?.name ?? null) === (physician?.name ?? null));
    if (!group) groups.push((group = { physician, residents: [] }));
    let resident = group.residents.find((item) => item.id === row.resident_id);
    if (!resident)
      group.residents.push(
        (resident = {
          id: String(row.resident_id),
          name: String(row.resident_name),
          room: String(row.room),
          careUnit: String(row.care_unit),
          diagnoses: [],
          items: [],
        }),
      );
    resident.items.push({
      id: String(row.id),
      category: String(row.category),
      body: String(row.body),
      occurredAt: iso(row.occurred_at) ?? "",
      author: String(row.author),
    });
  }
  const residentIds = groups.flatMap((group) => group.residents.map((resident) => resident.id));
  if (residentIds.length) {
    const diagnoses = (await ctx.sql`
      SELECT resident_id, label, icd_code FROM carecore_resident_diagnoses
      WHERE resident_id = ANY(${residentIds}::uuid[]) AND status = 'current'
      ORDER BY kind = 'secondary', since_on NULLS LAST, created_at`) as Row[];
    for (const group of groups)
      for (const resident of group.residents)
        resident.diagnoses = diagnoses
          .filter((row) => row.resident_id === resident.id)
          .map((row) => diagnosisText({ label: String(row.label), icdCode: String(row.icd_code) }));
  }
  return {
    careUnitId,
    canWrite: hasPermission(ctx.actor, "documentation.write"),
    open: open.length,
    groups,
    resolved: resolved.map((row) => ({
      entryId: String(row.entry_id),
      residentId: String(row.resident_id),
      residentName: String(row.resident_name),
      question: String(row.question),
      response: String(row.response ?? ""),
      physician: String(row.physician),
      resolvedAt: iso(row.resolved_at) ?? "",
      resolvedBy: String(row.resolved_by),
    })),
  };
}

// Rückmeldung zur Visite: neuer Eintrag „Arztvisite“ und die Frage gilt als erledigt (gemeinsam oder gar nicht).
export async function resolveVisitItem(ctx: ApiContext, entryInput: unknown, body: Record<string, unknown>) {
  if (!hasPermission(ctx.actor, "documentation.write")) throw new ApiError("Keine Berechtigung.", 403);
  const entryId = assertUuid(entryInput, "Eintrag");
  const response = text(body.response, 10000);
  if (response.length < 3) throw new ApiError("Bitte die Rückmeldung der Ärztin bzw. des Arztes festhalten.");
  const rows = (await ctx.sql`
    SELECT d.id, d.resident_id, d.importance, NULLIF(TRIM(r.gp_name), '') AS gp_name
    FROM carecore_documentation_entries d
    JOIN carecore_residents r ON r.id = d.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    WHERE d.id = ${entryId}`) as Row[];
  const entry = rows[0];
  if (!entry || entry.importance !== "visit") throw new ApiError("Eintrag für die Visite nicht gefunden.", 404);
  const physician = text(body.physician, 160) || String(entry.gp_name ?? "");
  const residentId = String(entry.resident_id);
  const responseId = randomUUID();
  try {
    await ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body,
          occurred_at, importance, metadata)
        SELECT ${responseId}, ${residentId},
          (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL
            ORDER BY started_at DESC LIMIT 1),
          ${ctx.actor.id}, 'Arztvisite', 'Arztvisite', ${response}, NOW(), 'standard',
          ${JSON.stringify({ visitQuestionId: entryId, physician })}::jsonb`,
      ctx.sql`
        INSERT INTO carecore_visit_resolutions (entry_id, organization_id, response_entry_id, physician, resolved_by)
        VALUES (${entryId}, ${ctx.actor.organizationId}, ${responseId}, ${physician}, ${ctx.actor.id})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "documentation_entry",
        entityId: entryId,
        action: "visit_answered",
        after: { residentId, physician, responseEntryId: responseId },
      }),
    ]);
  } catch (error) {
    if (String(error).includes("carecore_visit_resolutions_pkey"))
      throw new ApiError("Zu dieser Frage ist bereits eine Rückmeldung erfasst.", 409);
    throw error;
  }
  return { responseEntryId: responseId };
}
