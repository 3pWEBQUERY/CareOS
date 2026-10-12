import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { ApiError, iso, type Row, type Sql } from "@/lib/api-context";
import { hashPassword, hashSessionToken, verifyPassword } from "@/lib/auth";
import { RESUSCITATION_STATUSES, type ResuscitationStatus } from "@/lib/resident-record-shared";
import { carecoreDb } from "@/lib/server-data";
import { portalVisitItems } from "@/lib/portal-visits";
import {
  portalAreaAllowed,
  portalAreas,
  portalPasswordProblem,
  type PortalArea,
  type PortalKind,
  type PortalResident,
  type PortalResidentDetail,
} from "@/lib/portal-shared";

// Portal für Angehörige und Ärztinnen/Ärzte. Eigene Zugänge und Sitzungen (Cookie `carecore_portal`), getrennt von den
// Konten der Mitarbeitenden: eine Portal-Sitzung öffnet keine Schnittstelle der Pflege-App und umgekehrt. Gelesen wird
// nur, was eine gültige Freigabe öffnet (Person oder Wohnbereich, Bereiche, Zeitraum); jeder Zugriff wird protokolliert.

export const PORTAL_COOKIE = "carecore_portal";
const SESSION_HOURS = 12;

export type PortalActor = {
  id: string;
  organizationId: string;
  kind: PortalKind;
  displayName: string;
  mustChangePassword: boolean;
  userAgent: string | null;
};

export async function createPortalSession(sql: Sql, accountId: string, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await sql`DELETE FROM carecore_portal_sessions WHERE expires_at <= NOW()`;
  await sql`
    INSERT INTO carecore_portal_sessions (token_hash, account_id, user_agent, expires_at)
    VALUES (${hashSessionToken(token)}, ${accountId}, ${userAgent?.slice(0, 300) ?? null}, ${expiresAt.toISOString()})`;
  return { token, expiresAt };
}

export async function deletePortalSession(sql: Sql, token: string | undefined) {
  if (token) await sql`DELETE FROM carecore_portal_sessions WHERE token_hash = ${hashSessionToken(token)}`;
}

// Angemeldete Portal-Person aus dem Cookie; nur aktive Zugänge.
export async function portalActor(): Promise<PortalActor | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const rows = (await carecoreDb()`
    SELECT a.id, a.organization_id, a.kind, a.display_name, a.must_change_password, s.user_agent
    FROM carecore_portal_sessions s JOIN carecore_portal_accounts a ON a.id = s.account_id
    WHERE s.token_hash = ${hashSessionToken(token)} AND s.expires_at > NOW() AND a.active`) as Row[];
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    kind: row.kind as PortalKind,
    displayName: String(row.display_name),
    mustChangePassword: Boolean(row.must_change_password),
    userAgent: (row.user_agent as string | null) ?? null,
  };
}

// Anmeldung: Benutzername ohne Gross-/Kleinschreibung, nur aktive Zugänge.
export async function authenticatePortal(sql: Sql, username: string, password: string) {
  const rows = (await sql`
    SELECT id, password_hash FROM carecore_portal_accounts
    WHERE LOWER(username) = LOWER(${username}) AND active LIMIT 1`) as Row[];
  if (!rows[0] || !(await verifyPassword(password, String(rows[0].password_hash)))) return null;
  await sql`UPDATE carecore_portal_accounts SET last_login_at = NOW() WHERE id = ${rows[0].id}`;
  return String(rows[0].id);
}

export async function changePortalPassword(sql: Sql, actor: PortalActor, current: unknown, next: unknown) {
  if (typeof current !== "string" || typeof next !== "string") throw new ApiError("Bitte beide Passwörter angeben.");
  const problem = portalPasswordProblem(next);
  if (problem) throw new ApiError(problem);
  if (current === next) throw new ApiError("Das neue Passwort muss sich vom bisherigen unterscheiden.");
  const rows = (await sql`SELECT password_hash FROM carecore_portal_accounts WHERE id = ${actor.id}`) as Row[];
  if (!rows[0] || !(await verifyPassword(current, String(rows[0].password_hash))))
    throw new ApiError("Das bisherige Passwort stimmt nicht.", 403);
  await sql.transaction([
    sql`UPDATE carecore_portal_accounts SET password_hash = ${await hashPassword(next)}, must_change_password = FALSE,
      updated_at = NOW() WHERE id = ${actor.id}`,
    logStatement(sql, actor, null, "password_changed", []),
  ]);
}

function logStatement(sql: Sql, actor: PortalActor, residentId: string | null, action: string, areas: PortalArea[]) {
  return sql`
    INSERT INTO carecore_portal_access_log (id, organization_id, account_id, resident_id, action, areas, user_agent)
    VALUES (${randomUUID()}, ${actor.organizationId}, ${actor.id}, ${residentId}, ${action}, ${JSON.stringify(areas)}::jsonb,
      ${actor.userAgent?.slice(0, 300) ?? null})`;
}

// Personen mit gültiger Freigabe (direkt oder über den aktuellen Wohnbereich), Bereiche zusammengeführt.
export async function portalResidents(sql: Sql, actor: PortalActor): Promise<PortalResident[]> {
  const rows = (await sql`
    WITH org AS (SELECT (NOW() AT TIME ZONE timezone)::date AS today FROM carecore_organizations WHERE id = ${actor.organizationId}),
    grants AS (
      SELECT g.* FROM carecore_portal_grants g CROSS JOIN org
      WHERE g.account_id = ${actor.id} AND g.revoked_at IS NULL
        AND (g.valid_from IS NULL OR g.valid_from <= org.today) AND (g.valid_until IS NULL OR g.valid_until >= org.today)
    ),
    stays AS (
      SELECT DISTINCT ON (resident_id) resident_id, care_unit_id, room_id FROM carecore_resident_stays
      WHERE ended_at IS NULL ORDER BY resident_id, started_at DESC
    )
    SELECT r.id, r.first_name, r.last_name, to_char(r.date_of_birth, 'YYYY-MM-DD') AS birth_date,
      COALESCE(cu.name, '') AS care_unit, COALESCE(ro.name, '') AS room, jsonb_agg(g.areas) AS areas
    FROM carecore_residents r
    LEFT JOIN stays st ON st.resident_id = r.id
    LEFT JOIN carecore_care_units cu ON cu.id = st.care_unit_id
    LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
    JOIN grants g ON g.resident_id = r.id OR (g.care_unit_id IS NOT NULL AND g.care_unit_id = st.care_unit_id)
    WHERE r.organization_id = ${actor.organizationId} AND r.status = 'active'
    GROUP BY r.id, cu.name, ro.name
    ORDER BY r.last_name, r.first_name`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    name: `${row.first_name} ${row.last_name}`.trim(),
    birthDate: (row.birth_date as string | null) ?? null,
    careUnit: String(row.care_unit),
    room: String(row.room),
    areas: portalAreas((row.areas as unknown[]).flat()).filter((area) => portalAreaAllowed(actor.kind, area)),
  }));
}

const RESUSCITATION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(RESUSCITATION_STATUSES).map(([key, value]) => [key, value.label]),
);

// Daten einer Person, nur für die freigegebenen Bereiche; der Zugriff wird protokolliert.
export async function portalResidentDetail(
  sql: Sql,
  actor: PortalActor,
  residentId: string,
): Promise<PortalResidentDetail> {
  const resident = (await portalResidents(sql, actor)).find((entry) => entry.id === residentId);
  if (!resident) throw new ApiError("Keine Freigabe für diese Person.", 404);
  const has = (area: PortalArea) => resident.areas.includes(area);
  const detail: PortalResidentDetail = { ...resident };
  const tasks: Promise<void>[] = [];
  if (has("emergency"))
    tasks.push(
      (async () => {
        const [row] = (await sql`
          SELECT resuscitation_status, COALESCE(resuscitation_source, '') AS source,
            to_char(resuscitation_decided_on, 'YYYY-MM-DD') AS decided_on, COALESCE(medication_allergies, '') AS allergies
          FROM carecore_residents WHERE id = ${residentId}`) as Row[];
        detail.emergency = {
          resuscitation: row.resuscitation_status
            ? RESUSCITATION_LABELS[row.resuscitation_status as ResuscitationStatus]
            : "nicht erfasst",
          resuscitationSource: String(row.source),
          decidedOn: (row.decided_on as string | null) ?? null,
          allergies: String(row.allergies),
        };
      })(),
    );
  if (has("medication"))
    tasks.push(
      (async () => {
        const rows = (await sql`
          SELECT TRIM(COALESCE(m.name, '') || ' ' || COALESCE(m.strength, '')) AS name, o.dosage, o.schedule, o.is_prn,
            COALESCE(o.indication, '') AS indication
          FROM carecore_medication_orders o LEFT JOIN carecore_medications m ON m.id = o.medication_id
          WHERE o.resident_id = ${residentId} AND o.status = 'active'
          ORDER BY o.is_prn, m.name`) as Row[];
        detail.medication = rows.map((row) => {
          const dosage = (row.dosage ?? {}) as { amount?: unknown };
          const schedule = (row.schedule ?? {}) as { times?: unknown };
          return {
            name: String(row.name),
            amount: typeof dosage.amount === "string" ? dosage.amount : "",
            times: Array.isArray(schedule.times)
              ? schedule.times.filter((t): t is string => typeof t === "string")
              : [],
            prn: Boolean(row.is_prn),
            indication: String(row.indication),
          };
        });
      })(),
    );
  if (has("vitals"))
    tasks.push(
      (async () => {
        const rows = (await sql`
          SELECT metric, value, secondary_value, unit, measured_at FROM carecore_vital_measurements
          WHERE resident_id = ${residentId} AND measured_at > NOW() - INTERVAL '30 days'
          ORDER BY measured_at DESC LIMIT 200`) as Row[];
        detail.vitals = rows.map((row) => ({
          metric: String(row.metric),
          value:
            row.secondary_value === null || row.secondary_value === undefined
              ? String(Number(row.value))
              : `${Number(row.value)}/${Number(row.secondary_value)}`,
          unit: String(row.unit ?? ""),
          measuredAt: iso(row.measured_at) ?? "",
        }));
      })(),
    );
  if (has("reports"))
    tasks.push(
      (async () => {
        const rows = (await sql`
          SELECT category, COALESCE(title, '') AS title, body, occurred_at FROM carecore_documentation_entries
          WHERE resident_id = ${residentId} AND visibility = 'care_team' AND occurred_at > NOW() - INTERVAL '14 days'
          ORDER BY occurred_at DESC LIMIT 100`) as Row[];
        detail.reports = rows.map((row) => ({
          category: String(row.category),
          title: String(row.title),
          body: String(row.body),
          occurredAt: iso(row.occurred_at) ?? "",
        }));
      })(),
    );
  if (has("appointments"))
    tasks.push(
      (async () => {
        const rows = (await sql`
          SELECT title, starts_at, COALESCE(location, '') AS location, category
          FROM carecore_resident_appointments
          WHERE resident_id = ${residentId} AND starts_at >= NOW() - INTERVAL '1 day' AND status = 'scheduled'
          ORDER BY starts_at LIMIT 50`) as Row[];
        detail.appointments = rows.map((row) => ({
          title: String(row.title),
          startsAt: iso(row.starts_at) ?? "",
          location: String(row.location),
          category: String(row.category),
        }));
      })(),
    );
  if (has("wounds"))
    tasks.push(
      (async () => {
        const rows = (await sql`
          SELECT title, COALESCE(body_location, '') AS location, status, to_char(discovered_at, 'YYYY-MM-DD') AS since
          FROM carecore_wounds WHERE resident_id = ${residentId} AND closed_at IS NULL
          ORDER BY discovered_at DESC`) as Row[];
        detail.wounds = rows.map((row) => ({
          title: String(row.title),
          location: String(row.location),
          status: String(row.status),
          since: (row.since as string | null) ?? null,
        }));
      })(),
    );
  if (has("activities"))
    tasks.push(
      (async () => {
        const [attended, upcoming] = (await Promise.all([
          sql`
            SELECT a.title, a.category, a.starts_at FROM carecore_activity_participations p
            JOIN carecore_activities a ON a.id = p.activity_id
            WHERE p.resident_id = ${residentId} AND p.status = 'participated' AND a.cancelled_at IS NULL
              AND a.starts_at > NOW() - INTERVAL '30 days'
            ORDER BY a.starts_at DESC LIMIT 100`,
          // Angebote des eigenen Wohnbereichs und des ganzen Hauses in den nächsten 14 Tagen.
          sql`
            SELECT a.title, a.category, a.starts_at, a.location FROM carecore_activities a
            JOIN carecore_residents r ON r.id = ${residentId} AND r.organization_id = a.organization_id
            LEFT JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL
              ORDER BY started_at DESC LIMIT 1) stay ON TRUE
            WHERE a.cancelled_at IS NULL AND a.starts_at >= NOW() AND a.starts_at < NOW() + INTERVAL '14 days'
              AND (a.care_unit_id IS NULL OR a.care_unit_id = stay.care_unit_id)
            ORDER BY a.starts_at LIMIT 50`,
        ])) as Row[][];
        detail.activities = {
          attended: attended.map((row) => ({
            title: String(row.title),
            category: String(row.category),
            startsAt: iso(row.starts_at) ?? "",
          })),
          upcoming: upcoming.map((row) => ({
            title: String(row.title),
            category: String(row.category),
            startsAt: iso(row.starts_at) ?? "",
            location: String(row.location ?? ""),
          })),
        };
      })(),
    );
  if (has("visit"))
    tasks.push(
      portalVisitItems(sql, residentId).then((visit) => {
        detail.visit = visit;
      }),
    );
  await Promise.all(tasks);
  await logStatement(sql, actor, residentId, "resident_viewed", resident.areas);
  return detail;
}
