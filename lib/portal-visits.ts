import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, iso, text, type Row, type Sql } from "@/lib/api-context";
import { portalResidents, type PortalActor } from "@/lib/portal";
import type { PortalResidentDetail } from "@/lib/portal-shared";

// Visite im Portal: die Ärztin bzw. der Arzt sieht die offenen Fragen der Pflege („Für Visite“) und erfasst die
// Rückmeldung selbst. Die Rückmeldung wird wie in der Pflege als Eintrag „Arztvisite“ dokumentiert und schliesst die
// Frage; die Pflege des Wohnbereichs erhält einen Hinweis. CareOS wertet die Rückmeldung nicht aus.

export async function portalVisitItems(
  sql: Sql,
  residentId: string,
): Promise<NonNullable<PortalResidentDetail["visit"]>> {
  const [open, answered] = (await Promise.all([
    // Neueste Fassung je Eintrag: korrigierte Fragen erscheinen mit ihrer Korrektur.
    sql`
      SELECT d.id, d.category, d.body, d.occurred_at, COALESCE(u.display_name, 'Pflege') AS author
      FROM carecore_documentation_entries d
      LEFT JOIN carecore_users u ON u.id = d.author_user_id
      WHERE d.resident_id = ${residentId} AND d.importance = 'visit'
        AND NOT EXISTS (SELECT 1 FROM carecore_documentation_entries fix WHERE fix.amended_from_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM carecore_visit_resolutions v
          WHERE v.entry_id IN (d.id, COALESCE(d.amended_from_id, d.id)))
      ORDER BY d.occurred_at`,
    sql`
      SELECT q.body AS question, COALESCE(a.body, '') AS response, v.physician, v.resolved_at
      FROM carecore_visit_resolutions v
      JOIN carecore_documentation_entries q ON q.id = v.entry_id
      LEFT JOIN carecore_documentation_entries a ON a.id = v.response_entry_id
      WHERE q.resident_id = ${residentId} AND v.resolved_at > NOW() - INTERVAL '14 days'
      ORDER BY v.resolved_at DESC LIMIT 50`,
  ])) as Row[][];
  return {
    open: open.map((row) => ({
      id: String(row.id),
      category: String(row.category),
      body: String(row.body),
      occurredAt: iso(row.occurred_at) ?? "",
      author: String(row.author),
    })),
    answered: answered.map((row) => ({
      question: String(row.question),
      response: String(row.response),
      physician: String(row.physician),
      resolvedAt: iso(row.resolved_at) ?? "",
    })),
  };
}

// Rückmeldung aus dem Portal: nur mit gültiger Freigabe „Visite“ für die Person, nur für eine noch offene Frage in
// ihrer neuesten Fassung. Eintrag, Abschluss, Protokoll, Portal-Protokoll und Hinweis gelingen gemeinsam oder gar nicht.
export async function portalAnswerVisit(
  sql: Sql,
  actor: PortalActor,
  entryInput: unknown,
  body: Record<string, unknown>,
) {
  const entryId = assertUuid(entryInput, "Frage");
  const response = text(body.response, 10000);
  if (response.length < 3) throw new ApiError("Bitte die Rückmeldung zur Frage festhalten.");
  const [entry] = (await sql`
    SELECT d.id, d.resident_id, d.importance,
      EXISTS (SELECT 1 FROM carecore_documentation_entries fix WHERE fix.amended_from_id = d.id) AS amended
    FROM carecore_documentation_entries d
    JOIN carecore_residents r ON r.id = d.resident_id AND r.organization_id = ${actor.organizationId}
    WHERE d.id = ${entryId}`) as Row[];
  const residentId = entry ? String(entry.resident_id) : null;
  const resident = residentId ? (await portalResidents(sql, actor)).find((item) => item.id === residentId) : undefined;
  // Ohne Freigabe dieselbe Antwort wie bei einer unbekannten Frage: das Portal verrät keine fremden Einträge.
  if (!entry || entry.importance !== "visit" || !residentId || !resident?.areas.includes("visit"))
    throw new ApiError("Frage nicht gefunden.", 404);
  if (entry.amended) throw new ApiError("Die Pflege hat die Frage inzwischen korrigiert. Bitte neu laden.", 409);
  const responseId = randomUUID();
  const portalAuthor = `${actor.displayName} (Portal)`;
  try {
    await sql.transaction([
      sql`
        INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body,
          occurred_at, importance, metadata)
        SELECT ${responseId}, ${residentId},
          (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL
            ORDER BY started_at DESC LIMIT 1),
          NULL, 'Arztvisite', 'Arztvisite', ${response}, NOW(), 'standard',
          ${JSON.stringify({ visitQuestionId: entryId, physician: actor.displayName, portalAccountId: actor.id, portalAuthor })}::jsonb`,
      sql`
        INSERT INTO carecore_visit_resolutions (entry_id, organization_id, response_entry_id, physician,
          resolved_by_portal_account_id)
        VALUES (${entryId}, ${actor.organizationId}, ${responseId}, ${actor.displayName}, ${actor.id})`,
      sql`
        INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, user_agent, entity_type, entity_id, action,
          after_data)
        VALUES (${randomUUID()}, ${actor.organizationId}, NULL, ${actor.userAgent?.slice(0, 300) ?? null},
          'documentation_entry', ${entryId}, 'visit_answered',
          ${JSON.stringify({ residentId, physician: actor.displayName, responseEntryId: responseId, portalAccountId: actor.id, portalActor: portalAuthor })}::jsonb)`,
      sql`
        INSERT INTO carecore_portal_access_log (id, organization_id, account_id, resident_id, action, areas, user_agent)
        VALUES (${randomUUID()}, ${actor.organizationId}, ${actor.id}, ${residentId}, 'visit_answered', '["visit"]'::jsonb,
          ${actor.userAgent?.slice(0, 300) ?? null})`,
      // Hinweis an die Mitarbeitenden des Wohnbereichs, die dokumentieren dürfen.
      sql`
        INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
        SELECT gen_random_uuid(), u.id, ${`Visite: Rückmeldung von ${actor.displayName}`},
          (SELECT first_name || ' ' || last_name FROM carecore_residents WHERE id = ${residentId}) || ': ' || ${response.slice(0, 160)},
          'visit_answered', 'normal', '/c/pflegedokumentation/visite', 'documentation_entry', ${responseId}
        FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
        WHERE p.organization_id = ${actor.organizationId} AND u.active AND u.archived_at IS NULL
          AND carecore_effective_permissions(u.id) ? 'documentation.write'
          AND EXISTS (SELECT 1 FROM carecore_unit_memberships um
            JOIN carecore_resident_stays st ON st.care_unit_id = um.care_unit_id AND st.ended_at IS NULL
            WHERE um.user_id = u.id AND st.resident_id = ${residentId})`,
    ]);
  } catch (error) {
    if (String(error).includes("carecore_visit_resolutions_pkey"))
      throw new ApiError("Zu dieser Frage ist bereits eine Rückmeldung erfasst.", 409);
    throw error;
  }
  return { responseEntryId: responseId };
}
