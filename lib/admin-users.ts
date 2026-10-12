import { randomUUID } from "node:crypto";
import { assertPasswordPolicy } from "@/lib/password-rules";
import { auditOrigin, type AuditActor } from "@/lib/audit-origin";
import { neon } from "@neondatabase/serverless";
import "@/database/pg-fetch.mjs";
import { hashPassword } from "@/lib/auth";

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  jobTitle: string;
  phone: string;
  // Für „Passwort vergessen“ und den Link zum Setzen des Passworts.
  email: string;
  primaryCareUnitId: string | null;
  primaryCareUnitName: string | null;
  active: boolean;
  archivedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  // Heute gültige Qualifikationen (z. B. HF, FaGe); sie entscheiden in Rollen wie „Pflege“ über das Medikationsrecht.
  qualificationIds: string[];
  // Zwei-Faktor-Anmeldung eingeschaltet (die Administration kann sie zurücksetzen).
  mfa: boolean;
};
export type AdminQualification = { id: string; code: string; name: string; grantsMedication: boolean };
export type AdminCareUnit = { id: string; name: string; detail: string };
export type ManagedRole = {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  // Medikation nur für Personen mit einer dazu berechtigenden Qualifikation (z. B. HF, FaGe).
  medicationRequiresQualification: boolean;
  systemRole: boolean;
  userCount: number;
  createdAt: string;
};
export type AdminUserStats = {
  activeEmployees: number;
  archivedEmployees: number;
  roleCount: number;
  customRoleCount: number;
  unassignedActiveEmployees: number;
  auditEntriesLast30Days: number;
  lastAuditAt: string | null;
};
const roleKeys = [
  "residents.read",
  "residents.write",
  "documentation.write",
  "medication.administer",
  "medication.manage",
  "schedule.manage",
  "team.manage",
  "quality.manage",
  "insights.read",
  "administration.manage",
  "rai.manage",
  "ai.use",
  "funds.manage",
  "billing.manage",
];

// Leer bleibt leer (null); sonst eine einfache Formprüfung, gespeichert in Kleinbuchstaben.
export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("INVALID_EMAIL");
  return email;
}

async function assertEmailFree(sql: ReturnType<typeof database>, email: string, userId: string | null) {
  const rows = (await sql`SELECT user_id FROM carecore_user_profiles
    WHERE lower(email) = ${email} AND user_id IS DISTINCT FROM ${userId}::uuid LIMIT 1`) as unknown as unknown[];
  if (rows.length) throw new Error("EMAIL_TAKEN");
}

function database() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  return neon(connectionString);
}

// Users of the administrator's organization, plus users not yet assigned to any organization.
export async function listManagedUsers(actorId: string): Promise<{
  users: ManagedUser[];
  careUnits: AdminCareUnit[];
  qualifications: AdminQualification[];
  roles: ManagedRole[];
  stats: AdminUserStats;
}> {
  const sql = database();
  const users =
    (await sql`SELECT u.id, u.username, u.display_name, u.role, u.active, u.archived_at, u.created_at, p.job_title, p.phone, p.email, p.primary_care_unit_id, p.last_seen_at, cu.name AS primary_care_unit_name, EXISTS (SELECT 1 FROM carecore_user_mfa m WHERE m.user_id = u.id AND m.confirmed_at IS NOT NULL) AS mfa FROM carecore_users u LEFT JOIN carecore_user_profiles p ON p.user_id = u.id LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id WHERE p.organization_id IS NULL OR p.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}) ORDER BY u.archived_at NULLS FIRST, u.active DESC, u.display_name ASC`) as unknown as Array<{
      id: string;
      username: string;
      display_name: string;
      role: string;
      active: boolean;
      archived_at: string | null;
      created_at: string;
      job_title: string | null;
      phone: string | null;
      email: string | null;
      primary_care_unit_id: string | null;
      last_seen_at: string | null;
      primary_care_unit_name: string | null;
      mfa: boolean;
    }>;
  const careUnits =
    (await sql`SELECT cu.id, cu.name, COALESCE(cu.floor, '') AS floor FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id WHERE cu.active = TRUE AND si.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}) ORDER BY cu.name`) as unknown as Array<{
      id: string;
      name: string;
      floor: string;
    }>;
  const roles = await listManagedRoles(actorId);
  const [qualifications, held] = (await Promise.all([
    sql`SELECT q.id, q.code, q.name, q.grants_medication FROM carecore_qualifications q
      WHERE q.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}) ORDER BY q.code`,
    sql`SELECT eq.user_id, eq.qualification_id FROM carecore_employee_qualifications eq
      JOIN carecore_qualifications q ON q.id = eq.qualification_id
      JOIN carecore_organizations o ON o.id = q.organization_id
      WHERE q.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId})
        AND eq.valid_from <= (NOW() AT TIME ZONE o.timezone)::date
        AND (eq.valid_until IS NULL OR eq.valid_until >= (NOW() AT TIME ZONE o.timezone)::date)`,
  ])) as unknown as [
    Array<{ id: string; code: string; name: string; grants_medication: boolean }>,
    Array<{ user_id: string; qualification_id: string }>,
  ];
  const audit =
    (await sql`SELECT COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS recent_count, MAX(created_at) AS last_audit_at FROM carecore_audit_log WHERE entity_type IN ('user', 'role') AND organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId})`) as unknown as Array<{
      recent_count: number;
      last_audit_at: string | null;
    }>;
  const activeEmployees = users.filter((user) => user.active).length;
  const archivedEmployees = users.filter((user) => !user.active).length;
  const unassignedActiveEmployees = users.filter((user) => user.active && !user.primary_care_unit_id).length;
  return {
    users: users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      jobTitle: user.job_title ?? "Noch nicht angegeben",
      phone: user.phone ?? "",
      email: user.email ?? "",
      primaryCareUnitId: user.primary_care_unit_id,
      primaryCareUnitName: user.primary_care_unit_name,
      active: user.active,
      archivedAt: user.archived_at,
      createdAt: user.created_at,
      lastSeenAt: user.last_seen_at,
      qualificationIds: held.filter((row) => row.user_id === user.id).map((row) => row.qualification_id),
      mfa: Boolean(user.mfa),
    })),
    qualifications: qualifications.map((q) => ({
      id: q.id,
      code: q.code,
      name: q.name,
      grantsMedication: Boolean(q.grants_medication),
    })),
    careUnits: careUnits.map((unit) => ({ id: unit.id, name: unit.name, detail: unit.floor || "Wohnbereich" })),
    roles,
    stats: {
      activeEmployees,
      archivedEmployees,
      roleCount: roles.length,
      customRoleCount: roles.filter((role) => !role.systemRole).length,
      unassignedActiveEmployees,
      auditEntriesLast30Days: Number(audit[0]?.recent_count ?? 0),
      lastAuditAt: audit[0]?.last_audit_at ?? null,
    },
  };
}

// Systemrollen und die eigenen Rollen der Einrichtung; gezählt werden nur Personen der Einrichtung.
export async function listManagedRoles(actorId: string): Promise<ManagedRole[]> {
  const sql = database();
  const rows = (await sql`
    WITH org AS (SELECT organization_id AS id FROM carecore_user_profiles WHERE user_id = ${actorId})
    SELECT r.id, r.key, r.name, r.description, r.permissions, r.medication_requires_qualification, r.system_role, r.created_at,
      COUNT(u.id)::int AS user_count
    FROM carecore_roles r CROSS JOIN org
    LEFT JOIN carecore_user_profiles p ON p.organization_id = org.id
    LEFT JOIN carecore_users u ON u.id = p.user_id AND u.role = r.key
    WHERE r.system_role OR r.organization_id = org.id
    GROUP BY r.id ORDER BY r.system_role DESC, r.name`) as unknown as Array<{
    id: string;
    key: string;
    name: string;
    description: string;
    permissions: string[];
    medication_requires_qualification: boolean;
    system_role: boolean;
    created_at: string;
    user_count: number;
  }>;
  return rows.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
    medicationRequiresQualification: Boolean(role.medication_requires_qualification),
    systemRole: role.system_role,
    userCount: Number(role.user_count),
    createdAt: role.created_at,
  }));
}

async function assertManagedUser(sql: ReturnType<typeof database>, actorId: string, userId: string) {
  const found = await sql`
    SELECT u.id FROM carecore_users u LEFT JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE u.id = ${userId} AND (p.organization_id IS NULL OR p.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}))
    LIMIT 1`;
  if (!found[0]) throw new Error("USER_NOT_FOUND");
}

async function assertCareUnit(sql: ReturnType<typeof database>, actorId: string, careUnitId: string) {
  const unit = await sql`
    SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
    WHERE cu.id = ${careUnitId} AND cu.active = TRUE AND si.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId})
    LIMIT 1`;
  if (!unit[0]) throw new Error("CARE_UNIT_NOT_FOUND");
}

// Vergeben werden dürfen Systemrollen und die eigenen Rollen der Einrichtung.
async function assertRole(sql: ReturnType<typeof database>, actorId: string, role: string) {
  const found = (await sql`
    SELECT key FROM carecore_roles
    WHERE key = ${role} AND (system_role OR organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}))
    LIMIT 1`) as unknown as Array<{
    key: string;
  }>;
  if (!found[0]) throw new Error("ROLE_NOT_FOUND");
}

export async function updateManagedUser(
  actorInput: string | AuditActor,
  userId: string,
  input: {
    displayName?: string;
    username?: string;
    role?: string;
    jobTitle?: string;
    phone?: string;
    email?: string;
    primaryCareUnitId?: string | null;
    qualificationIds?: string[];
    action?: "lock" | "restore";
  },
) {
  const actorId = typeof actorInput === "string" ? actorInput : actorInput.id;
  const who = { id: actorId, ...auditOrigin(actorInput) };
  const sql = database();
  await assertManagedUser(sql, actorId, userId);
  // Änderung und Protokoll gemeinsam.
  if (input.action === "lock") {
    if (userId === actorId) throw new Error("CANNOT_LOCK_SELF");
    await sql.transaction([
      sql`UPDATE carecore_users SET active = FALSE, archived_at = NOW(), archived_by = ${actorId}, archive_reason = 'Zugriff durch Administration gesperrt', updated_at = NOW() WHERE id = ${userId}`,
      sql`DELETE FROM carecore_sessions WHERE user_id = ${userId}`,
      auditStatement(sql, who, "user", userId, "lock", input),
    ]);
  } else if (input.action === "restore") {
    await sql.transaction([
      sql`UPDATE carecore_users SET active = TRUE, archived_at = NULL, archived_by = NULL, archive_reason = NULL, updated_at = NOW() WHERE id = ${userId}`,
      auditStatement(sql, who, "user", userId, "restore", input),
    ]);
  } else {
    const name = input.displayName?.trim().slice(0, 120);
    const username = input.username?.trim().slice(0, 80);
    const role = input.role?.trim().slice(0, 40);
    if (!name || !username || !role) throw new Error("INVALID_USER_INPUT");
    const email = input.email === undefined ? undefined : normalizeEmail(input.email);
    await assertRole(sql, actorId, role);
    if (email) await assertEmailFree(sql, email, userId);
    if (input.primaryCareUnitId) await assertCareUnit(sql, actorId, input.primaryCareUnitId);
    const qualifications = input.qualificationIds
      ? await qualificationChanges(sql, actorId, userId, input.qualificationIds)
      : [];
    await sql.transaction([
      sql`UPDATE carecore_users SET display_name = ${name}, username = ${username}, role = ${role}, updated_at = NOW() WHERE id = ${userId}`,
      sql`INSERT INTO carecore_user_profiles (user_id, organization_id, job_title, phone, primary_care_unit_id) VALUES (${userId}, (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}), ${input.jobTitle?.trim().slice(0, 140) || null}, ${input.phone?.trim().slice(0, 60) || null}, ${input.primaryCareUnitId ?? null}) ON CONFLICT (user_id) DO UPDATE SET organization_id = COALESCE(carecore_user_profiles.organization_id, EXCLUDED.organization_id), job_title = EXCLUDED.job_title, phone = EXCLUDED.phone, primary_care_unit_id = EXCLUDED.primary_care_unit_id, updated_at = NOW()`,
      ...(email !== undefined
        ? [sql`UPDATE carecore_user_profiles SET email = ${email} WHERE user_id = ${userId}`]
        : []),
      ...(input.primaryCareUnitId
        ? [
            sql`UPDATE carecore_user_unit_assignments SET is_primary = FALSE WHERE user_id = ${userId}`,
            sql`INSERT INTO carecore_user_unit_assignments (user_id, care_unit_id, assignment_role, is_primary) VALUES (${userId}, ${input.primaryCareUnitId}, 'Mitarbeitende:r', TRUE) ON CONFLICT (user_id, care_unit_id) DO UPDATE SET is_primary = TRUE, ends_on = NULL`,
          ]
        : []),
      ...qualifications,
      auditStatement(sql, who, "user", userId, "updated", input),
    ]);
  }
  return listManagedUsers(actorId);
}

// Qualifikationen setzen: neue gelten ab heute, entfernte enden gestern (am selben Tag vergebene werden
// zurückgenommen); frühere Zeiträume bleiben als Verlauf erhalten.
async function qualificationChanges(
  sql: ReturnType<typeof database>,
  actorId: string,
  userId: string,
  requested: string[],
) {
  const own = (await sql`
    SELECT q.id FROM carecore_qualifications q
    WHERE q.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId})`) as unknown as Array<{
    id: string;
  }>;
  const allowed = new Set(own.map((row) => row.id));
  const wanted = [...new Set(requested)];
  if (wanted.some((id) => !allowed.has(id))) throw new Error("QUALIFICATION_NOT_FOUND");
  return [
    sql`DELETE FROM carecore_employee_qualifications eq USING carecore_organizations o, carecore_user_profiles p
      WHERE eq.user_id = ${userId} AND p.user_id = ${actorId} AND o.id = p.organization_id
        AND NOT (eq.qualification_id = ANY(${wanted}::uuid[]))
        AND eq.valid_from = (NOW() AT TIME ZONE o.timezone)::date`,
    sql`UPDATE carecore_employee_qualifications eq SET valid_until = (NOW() AT TIME ZONE o.timezone)::date - 1
      FROM carecore_organizations o, carecore_user_profiles p
      WHERE eq.user_id = ${userId} AND p.user_id = ${actorId} AND o.id = p.organization_id
        AND NOT (eq.qualification_id = ANY(${wanted}::uuid[]))
        AND eq.valid_from < (NOW() AT TIME ZONE o.timezone)::date
        AND (eq.valid_until IS NULL OR eq.valid_until >= (NOW() AT TIME ZONE o.timezone)::date)`,
    sql`INSERT INTO carecore_employee_qualifications (user_id, qualification_id, valid_from)
      SELECT ${userId}, wanted.id, (NOW() AT TIME ZONE o.timezone)::date
      FROM unnest(${wanted}::uuid[]) AS wanted(id)
      JOIN carecore_user_profiles p ON p.user_id = ${actorId}
      JOIN carecore_organizations o ON o.id = p.organization_id
      WHERE NOT EXISTS (
        SELECT 1 FROM carecore_employee_qualifications eq
        WHERE eq.user_id = ${userId} AND eq.qualification_id = wanted.id
          AND eq.valid_from <= (NOW() AT TIME ZONE o.timezone)::date
          AND (eq.valid_until IS NULL OR eq.valid_until >= (NOW() AT TIME ZONE o.timezone)::date))
      ON CONFLICT DO NOTHING`,
  ];
}

export async function createManagedUser(
  actorInput: string | AuditActor,
  input: {
    displayName: string;
    username: string;
    password: string;
    role: string;
    jobTitle?: string;
    phone?: string;
    email?: string;
    primaryCareUnitId?: string | null;
    // Zufällig erzeugtes Passwort (Einladung, Datenübernahme): keine Prüfung gegen die Passwort-Richtlinie.
    generatedPassword?: boolean;
  },
) {
  const actorId = typeof actorInput === "string" ? actorInput : actorInput.id;
  const who = { id: actorId, ...auditOrigin(actorInput) };
  const displayName = input.displayName.trim().slice(0, 120);
  const username = input.username.trim().slice(0, 80);
  const role = input.role.trim().slice(0, 40);
  if (!displayName || !username || !role || input.password.length < 10) throw new Error("INVALID_EMPLOYEE_INPUT");
  const email = normalizeEmail(input.email ?? "");
  const sql = database();
  if (!input.generatedPassword) await assertPasswordPolicy(sql, actorId, input.password, { username, displayName });
  await assertRole(sql, actorId, role);
  if (input.primaryCareUnitId) await assertCareUnit(sql, actorId, input.primaryCareUnitId);
  if (email) await assertEmailFree(sql, email, null);
  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  await sql.transaction([
    sql`INSERT INTO carecore_users (id, username, display_name, role, password_hash) VALUES (${id}, ${username}, ${displayName}, ${role}, ${passwordHash})`,
    // New employees belong to the organization of the administrator who creates them.
    sql`INSERT INTO carecore_user_profiles (user_id, organization_id, job_title, phone, email, primary_care_unit_id) VALUES (${id}, (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}), ${input.jobTitle?.trim().slice(0, 140) || null}, ${input.phone?.trim().slice(0, 60) || null}, ${email}, ${input.primaryCareUnitId ?? null})`,
    ...(input.primaryCareUnitId
      ? [
          sql`INSERT INTO carecore_user_unit_assignments (user_id, care_unit_id, assignment_role, is_primary) VALUES (${id}, ${input.primaryCareUnitId}, 'Mitarbeitende:r', TRUE)`,
        ]
      : []),
    auditStatement(sql, who, "user", id, "created", {
      displayName,
      username,
      role,
      primaryCareUnitId: input.primaryCareUnitId ?? null,
    }),
  ]);
  return listManagedUsers(actorId);
}

// Alle Sitzungen einer Person beenden (z. B. verlorenes Gerät): sie muss sich überall neu anmelden.
export async function endManagedUserSessions(actorInput: AuditActor, userId: string) {
  const actorId = actorInput.id;
  const who = { id: actorId, ...auditOrigin(actorInput) };
  if (userId === actorId) throw new Error("CANNOT_END_OWN_SESSIONS");
  const sql = database();
  await assertManagedUser(sql, actorId, userId);
  const [ended] = (await sql.transaction([
    sql`DELETE FROM carecore_sessions WHERE user_id = ${userId} RETURNING id`,
  ])) as Array<Array<{ id: string }>>;
  await auditStatement(sql, who, "user", userId, "sessions_ended", { sessions: ended.length });
  return { ended: ended.length };
}

export async function deleteManagedUser(actorInput: string | AuditActor, userId: string) {
  const actorId = typeof actorInput === "string" ? actorInput : actorInput.id;
  const who = { id: actorId, ...auditOrigin(actorInput) };
  if (userId === actorId) throw new Error("CANNOT_DELETE_SELF");
  const sql = database();
  await assertManagedUser(sql, actorId, userId);
  await sql.transaction([
    auditStatement(sql, who, "user", userId, "deleted", { permanentlyDeleted: true }),
    sql`DELETE FROM carecore_users WHERE id = ${userId}`,
  ]);
  return listManagedUsers(actorId);
}

function normalizePermissions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && roleKeys.includes(item)))];
}

export async function createManagedRole(
  actorInput: string | AuditActor,
  input: {
    key: string;
    name: string;
    description?: string;
    permissions?: unknown;
    medicationRequiresQualification?: boolean;
    // Kopie einer bestehenden Rolle (Systemrolle oder eigene Rolle der Einrichtung); wird mitprotokolliert.
    copyOf?: string;
  },
) {
  const actorId = typeof actorInput === "string" ? actorInput : actorInput.id;
  const who = { id: actorId, ...auditOrigin(actorInput) };
  const sql = database();
  let copyOf: { id: string; key: string } | null = null;
  if (input.copyOf) {
    const source = (await sql`
      SELECT id, key FROM carecore_roles
      WHERE id::text = ${input.copyOf} AND (system_role OR organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}))
      LIMIT 1`) as unknown as Array<{ id: string; key: string }>;
    if (!source[0]) throw new Error("ROLE_NOT_FOUND");
    copyOf = source[0];
  }
  const key = input.key.trim().toLowerCase().slice(0, 40);
  const name = input.name.trim().slice(0, 100);
  if (!name || !/^[a-z0-9:_-]+$/.test(key) || ["admin", "leitung", "pflege", "arzt", "mitarbeitende:r"].includes(key))
    throw new Error("INVALID_ROLE_INPUT");
  const id = randomUUID();
  const permissions = normalizePermissions(input.permissions);
  const medicationRequiresQualification = input.medicationRequiresQualification === true;
  await sql.transaction([
    sql`INSERT INTO carecore_roles (id, key, name, description, permissions, medication_requires_qualification, created_by, organization_id) VALUES (${id}, ${key}, ${name}, ${input.description?.trim().slice(0, 500) ?? ""}, ${JSON.stringify(permissions)}::jsonb, ${medicationRequiresQualification}, ${actorId}, (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}))`,
    auditStatement(sql, who, "role", id, copyOf ? "copied" : "created", {
      key,
      name,
      permissions,
      medicationRequiresQualification,
      ...(copyOf ? { copyOf: copyOf.key } : {}),
    }),
  ]);
  return listManagedRoles(actorId);
}

export async function updateManagedRole(
  actorInput: string | AuditActor,
  roleId: string,
  input: { name: string; description?: string; permissions?: unknown; medicationRequiresQualification?: boolean },
) {
  const actorId = typeof actorInput === "string" ? actorInput : actorInput.id;
  const who = { id: actorId, ...auditOrigin(actorInput) };
  const sql = database();
  const name = input.name.trim().slice(0, 100);
  if (!name) throw new Error("INVALID_ROLE_INPUT");
  const permissions = normalizePermissions(input.permissions);
  // Ohne Angabe bleibt die bisherige Einstellung erhalten.
  const medicationRequiresQualification =
    typeof input.medicationRequiresQualification === "boolean" ? input.medicationRequiresQualification : null;
  // The admin role always keeps every permission so administrators cannot lock themselves out. Die Leitung verabreicht
  // Medikamente immer, ohne Qualifikation (Entscheidung der Einrichtung, docs/TODO.md).
  const [updated] = (await sql.transaction([
    sql`UPDATE carecore_roles SET name = ${name}, description = ${input.description?.trim().slice(0, 500) ?? ""}, permissions = CASE WHEN key = 'admin' THEN ${JSON.stringify(roleKeys)}::jsonb WHEN key = 'leitung' THEN ${JSON.stringify([...new Set([...permissions, "medication.administer"])])}::jsonb ELSE ${JSON.stringify(permissions)}::jsonb END, medication_requires_qualification = CASE WHEN key IN ('admin', 'leitung') THEN FALSE ELSE COALESCE(${medicationRequiresQualification}::boolean, medication_requires_qualification) END, updated_at = NOW() WHERE id = ${roleId} AND (system_role OR organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId})) RETURNING id`,
    // Nur protokolliert, wenn die Rolle existiert.
    sql`INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
      SELECT ${randomUUID()}, (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}), ${actorId},
        ${who.sessionId}, ${who.userAgent}, 'role', id,
        'updated', ${JSON.stringify({ name, permissions, medicationRequiresQualification })}::jsonb
      FROM carecore_roles WHERE id = ${roleId} AND (system_role OR organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId}))`,
  ])) as unknown as Array<Array<{ id: string }>>;
  if (!updated[0]) throw new Error("ROLE_NOT_FOUND");
  return listManagedRoles(actorId);
}

export async function deleteManagedRole(actorInput: string | AuditActor, roleId: string) {
  const actorId = typeof actorInput === "string" ? actorInput : actorInput.id;
  const who = { id: actorId, ...auditOrigin(actorInput) };
  const sql = database();
  const role =
    (await sql`SELECT key, system_role FROM carecore_roles WHERE id = ${roleId} AND (system_role OR organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actorId})) LIMIT 1`) as unknown as Array<{
      key: string;
      system_role: boolean;
    }>;
  if (!role[0]) throw new Error("ROLE_NOT_FOUND");
  if (role[0].system_role) throw new Error("SYSTEM_ROLE_PROTECTED");
  const users =
    (await sql`SELECT COUNT(*)::int AS count FROM carecore_users WHERE role = ${role[0].key}`) as unknown as Array<{
      count: number;
    }>;
  if (Number(users[0]?.count) > 0) throw new Error("ROLE_IN_USE");
  await sql.transaction([
    sql`DELETE FROM carecore_roles WHERE id = ${roleId}`,
    auditStatement(sql, who, "role", roleId, "deleted", { key: role[0].key }),
  ]);
  return listManagedRoles(actorId);
}

// Protokolleintrag mit der Organisation der handelnden Person, für `sql.transaction([...])`.
function auditStatement(
  sql: ReturnType<typeof database>,
  who: { id: string; sessionId: string | null; userAgent: string | null },
  entityType: "user" | "role",
  entityId: string,
  action: string,
  afterData: unknown,
) {
  return sql`INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
    VALUES (${randomUUID()}, (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${who.id}), ${who.id},
      ${who.sessionId}, ${who.userAgent}, ${entityType}, ${entityId}, ${action}, ${JSON.stringify(afterData)}::jsonb)`;
}
