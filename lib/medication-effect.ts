import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { EFFECT_RESULTS, type EffectCheck, type EffectResult } from "@/lib/medication-shared";
import { auditOrigin } from "@/lib/audit-origin";

// Wirkungskontrolle nach Reservegabe: der Termin entsteht bei der Gabe aus der Verordnung
// (dosage.effectCheckMinutes), hier werden offene Kontrollen gelistet, erfasst und erinnert.

function mapCheck(row: Row): EffectCheck {
  return {
    administrationId: String(row.id),
    residentId: String(row.resident_id),
    residentName: String(row.resident_name),
    room: (row.room as string | null) ?? "",
    medication: String(row.medication),
    reason: (row.note as string | null) ?? "",
    administeredAt: iso(row.administered_at) ?? "",
    administeredBy: (row.administered_by_name as string | null) ?? null,
    dueAt: iso(row.effect_check_due_at) ?? "",
    overdue: Boolean(row.overdue),
  };
}

// Offene Kontrollen der Organisation, auf Wunsch nur für einen Bewohner.
export async function listEffectChecks(ctx: ApiContext, residentIdInput?: unknown): Promise<EffectCheck[]> {
  const residentId = residentIdInput ? await assertResident(ctx, residentIdInput) : null;
  const rows = (await ctx.sql`
    SELECT a.id, a.resident_id, a.note, a.administered_at, a.effect_check_due_at, a.effect_check_due_at < NOW() AS overdue,
      r.first_name || ' ' || r.last_name AS resident_name, ro.name AS room, u.display_name AS administered_by_name,
      TRIM(CONCAT_WS(' ', COALESCE(m.name, 'Unbekanntes Präparat'), m.strength)) AS medication
    FROM carecore_medication_administrations a
    JOIN carecore_residents r ON r.id = a.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    JOIN carecore_medication_orders o ON o.id = a.medication_order_id
    LEFT JOIN carecore_medications m ON m.id = o.medication_id
    LEFT JOIN carecore_users u ON u.id = a.administered_by
    LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    WHERE a.status = 'administered' AND a.effect_check_due_at IS NOT NULL AND a.effect_checked_at IS NULL
      AND (${residentId}::uuid IS NULL OR a.resident_id = ${residentId}::uuid)
    ORDER BY a.effect_check_due_at
    LIMIT 200`) as Row[];
  return rows.map(mapCheck);
}

// Ergebnis erfassen: Pflegedokumentation (Kategorie Medikation) und Protokoll in einer Transaktion.
export async function recordEffectCheck(
  ctx: ApiContext,
  administrationIdInput: unknown,
  body: Record<string, unknown>,
) {
  const administrationId = assertUuid(administrationIdInput, "Gabe");
  const result = String(body.result) as EffectResult;
  if (!(result in EFFECT_RESULTS)) throw new ApiError("Bitte das Ergebnis der Wirkungskontrolle wählen.");
  const note = text(body.note, 2000);
  if (result !== "effective" && note.length < 3)
    throw new ApiError("Bitte beschreiben, wie die Wirkung eingeschätzt wurde und was veranlasst wird.");
  const rows = (await ctx.sql`
    SELECT a.id, a.resident_id, a.administered_at, a.effect_check_due_at, a.effect_checked_at,
      TRIM(CONCAT_WS(' ', COALESCE(m.name, 'Unbekanntes Präparat'), m.strength)) AS medication,
      to_char(a.administered_at AT TIME ZONE COALESCE(org.timezone, 'Europe/Zurich'), 'HH24:MI') AS given_time
    FROM carecore_medication_administrations a
    JOIN carecore_residents r ON r.id = a.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    JOIN carecore_organizations org ON org.id = r.organization_id
    JOIN carecore_medication_orders o ON o.id = a.medication_order_id
    LEFT JOIN carecore_medications m ON m.id = o.medication_id
    WHERE a.id = ${administrationId} AND a.status = 'administered'`) as Row[];
  const row = rows[0];
  if (!row) throw new ApiError("Gabe nicht gefunden.", 404);
  if (!row.effect_check_due_at) throw new ApiError("Für diese Gabe ist keine Wirkungskontrolle vorgesehen.", 409);
  if (row.effect_checked_at) throw new ApiError("Die Wirkungskontrolle wurde bereits erfasst.", 409);
  const label = EFFECT_RESULTS[result];
  const entry = `Wirkungskontrolle ${String(row.medication)} (Gabe ${String(row.given_time)} Uhr): ${label}${note ? ` – ${note}` : ""}`;
  // Eine Anweisung: nur wer die Kontrolle als Erste:r erfasst, schreibt Dokumentation und Protokoll.
  const updated = (await ctx.sql`
    WITH u AS (
      UPDATE carecore_medication_administrations SET effect_checked_at = NOW(), effect_checked_by = ${ctx.actor.id},
        effect_result = ${result}, effect_note = ${note || null}, updated_at = NOW()
      WHERE id = ${administrationId} AND effect_checked_at IS NULL
      RETURNING id
    ), d AS (
      INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body, occurred_at, importance)
      SELECT ${randomUUID()}, ${row.resident_id},
        (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${row.resident_id} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1),
        ${ctx.actor.id}, 'Medikation', 'Wirkungskontrolle', ${entry}, NOW(), ${result === "effective" ? "standard" : "important"}
      FROM u
    )
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
    SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'medication_administration', u.id, 'effect_checked',
      ${JSON.stringify({ residentId: row.resident_id, result, note })}::jsonb
    FROM u
    RETURNING id`) as Row[];
  if (!updated[0]) throw new ApiError("Die Wirkungskontrolle wurde gerade anderweitig erfasst.", 409);
}

// Erinnerung an die Person, die die Reserve gegeben hat, sobald die Kontrolle fällig ist (einmal je Gabe).
export async function createEffectCheckReminders(ctx: ApiContext) {
  if (!ctx.actor.permissions.includes("medication.administer")) return;
  await ctx.sql`
    WITH due AS (
      UPDATE carecore_medication_administrations a SET effect_reminded_at = NOW()
      FROM carecore_residents r, carecore_medication_orders o
      WHERE r.id = a.resident_id AND r.organization_id = ${ctx.actor.organizationId} AND o.id = a.medication_order_id
        AND a.administered_by = ${ctx.actor.id} AND a.status = 'administered'
        AND a.effect_check_due_at <= NOW() AND a.effect_checked_at IS NULL AND a.effect_reminded_at IS NULL
        AND a.effect_check_due_at > NOW() - INTERVAL '24 hours'
      RETURNING a.id, r.first_name || ' ' || r.last_name AS resident_name, o.medication_id
    )
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
    SELECT gen_random_uuid(), ${ctx.actor.id}, 'Wirkungskontrolle fällig: ' || due.resident_name,
      TRIM(CONCAT_WS(' ', COALESCE(m.name, 'Reservegabe'), m.strength)) || ' · bitte Wirkung einschätzen und dokumentieren.',
      'medication_effect_check', 'high', '/c/medikation/reserven', 'medication_administration', due.id
    FROM due LEFT JOIN carecore_medications m ON m.id = due.medication_id`;
}
