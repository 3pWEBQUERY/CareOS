import { neon } from "@neondatabase/serverless";
import "@/database/pg-fetch.mjs";
import { resolveSettings, type AppSettings } from "@/lib/settings-shared";
import { resolveTerminology, termsFor, type TerminologyKey } from "@/lib/terminology";
import { resolvePreferences, type UserPreferences } from "@/lib/user-settings-shared";
import { countryCode, type CountryCode } from "@/lib/country";
import { mistralConfigured } from "@/lib/mistral";

export type CareUnit = { id: string; name: string; detail: string; residentCount: number; primary: boolean };
export type ContextResident = {
  id: string;
  initials: string;
  name: string;
  room: string;
  careUnitId: string;
  group: string;
  status: string;
  tone: "stable" | "attention" | "critical" | "info";
};
export type WorkContext = {
  profile: {
    // Für die Offline-Warteschlange: Einträge werden nur mit der Sitzung derselben Person gesendet.
    userId: string;
    displayName: string;
    jobTitle: string;
    phone: string;
    role: string;
    permissions: string[];
    primaryCareUnitId: string | null;
    primaryCareUnitName: string | null;
    organizationName: string;
    // Stand des Logos der Einrichtung (für den Abruf ohne veralteten Zwischenspeicher); null ohne Logo.
    logoUpdatedAt: string | null;
    // Zwei-Faktor-Pflicht der Einrichtung: Leitungsrechte gelten erst nach Einrichten von Zwei-Faktor oder Passkey.
    strongLoginMissing: boolean;
    // CareOS KI ist eingerichtet und die Person darf sie nutzen (z. B. Diktat umformulieren).
    aiReady: boolean;
  };
  careUnits: CareUnit[];
  residents: ContextResident[];
  settings: AppSettings;
  terminology: TerminologyKey;
  // Land der Einrichtung (Pflegestufen, Sozialversicherungsnummer usw.).
  country: CountryCode;
  // Vitalparameter, die die Einrichtung nicht erfasst.
  hiddenVitals: string[];
  preferences: UserPreferences;
};

function database() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  return neon(connectionString);
}

// Demo data lives in database/seed-demo.mjs; this only reads the user's own organization.
export async function getWorkContext(userId: string): Promise<WorkContext> {
  const sql = database();
  // Independent reads run in parallel to keep the header fast.
  const [profileResult, unitResult, residentResult] = await Promise.all([
    sql`SELECT u.display_name, u.role, COALESCE(carecore_access_permissions(u.id), '[]'::jsonb) AS permissions, COALESCE(carecore_strong_login_missing(u.id), FALSE) AS strong_login_missing, COALESCE(p.job_title, 'Mitarbeitende:r') AS job_title, COALESCE(p.phone, '') AS phone, p.primary_care_unit_id, cu.name AS primary_care_unit_name, COALESCE(o.name, 'CareOS') AS organization_name, o.logo_updated_at, o.settings->'app' AS app_settings, o.settings->'terminology' AS terminology, o.country, o.settings->'hiddenVitals' AS hidden_vitals, p.preferences AS user_preferences FROM carecore_users u LEFT JOIN carecore_user_profiles p ON p.user_id = u.id LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id LEFT JOIN carecore_organizations o ON o.id = p.organization_id WHERE u.id = ${userId} LIMIT 1`,
    sql`SELECT cu.id, cu.name, COALESCE(cu.floor, '') AS floor, COUNT(r.id)::int AS resident_count FROM carecore_care_units cu LEFT JOIN carecore_resident_stays rs ON rs.care_unit_id = cu.id AND rs.ended_at IS NULL LEFT JOIN carecore_residents r ON r.id = rs.resident_id AND r.status = 'active' JOIN carecore_sites si ON si.id = cu.site_id WHERE cu.active = TRUE AND si.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${userId}) GROUP BY cu.id, cu.name, cu.floor ORDER BY (cu.id = (SELECT primary_care_unit_id FROM carecore_user_profiles WHERE user_id = ${userId})) DESC NULLS LAST, cu.name`,
    sql`SELECT r.id, r.first_name, r.last_name, r.status, cu.id AS care_unit_id, cu.name AS care_unit_name, COALESCE(room.name, 'Ohne Zimmer') AS room, COALESCE(r.risk_flags->0->>'label', 'Stabil') AS flag, COALESCE(r.risk_flags->0->>'tone', 'stable') AS tone FROM carecore_residents r JOIN LATERAL (SELECT * FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) rs ON TRUE LEFT JOIN carecore_care_units cu ON cu.id = rs.care_unit_id LEFT JOIN carecore_rooms room ON room.id = rs.room_id WHERE r.status = 'active' AND r.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${userId}) ORDER BY (cu.id = (SELECT primary_care_unit_id FROM carecore_user_profiles WHERE user_id = ${userId})) DESC NULLS LAST, cu.name, r.last_name, r.first_name`,
  ]);
  const profileRows = profileResult as unknown as Array<{
    display_name: string;
    role: string;
    permissions: unknown;
    job_title: string;
    phone: string;
    primary_care_unit_id: string | null;
    primary_care_unit_name: string | null;
    organization_name: string;
    strong_login_missing: boolean;
    logo_updated_at: Date | string | null;
    app_settings: unknown;
    terminology: unknown;
    country: unknown;
    hidden_vitals: unknown;
    user_preferences: unknown;
  }>;
  const unitRows = unitResult as unknown as Array<{
    id: string;
    name: string;
    floor: string;
    resident_count: number;
  }>;
  const residentRows = residentResult as unknown as Array<{
    id: string;
    first_name: string;
    last_name: string;
    status: string;
    care_unit_id: string;
    care_unit_name: string;
    room: string;
    flag: string;
    tone: ContextResident["tone"];
  }>;
  const profile = profileRows[0];
  if (!profile) throw new Error("PROFILE_NOT_FOUND");
  const terms = termsFor(profile.terminology);
  return {
    profile: {
      userId,
      displayName: profile.display_name,
      jobTitle: profile.job_title,
      phone: profile.phone,
      role: profile.role,
      permissions: Array.isArray(profile.permissions) ? (profile.permissions as string[]) : [],
      primaryCareUnitId: profile.primary_care_unit_id,
      primaryCareUnitName: profile.primary_care_unit_name,
      organizationName: profile.organization_name,
      strongLoginMissing: Boolean(profile.strong_login_missing),
      aiReady:
        mistralConfigured() &&
        Array.isArray(profile.permissions) &&
        (profile.permissions as string[]).includes("ai.use"),
      logoUpdatedAt: profile.logo_updated_at
        ? profile.logo_updated_at instanceof Date
          ? profile.logo_updated_at.toISOString()
          : String(profile.logo_updated_at)
        : null,
    },
    careUnits: unitRows.map((unit) => ({
      id: unit.id,
      name: unit.name,
      detail: `${unit.floor || "Wohnbereich"} · ${unit.resident_count} ${Number(unit.resident_count) === 1 ? terms.one : terms.many}`,
      residentCount: Number(unit.resident_count),
      primary: unit.id === profile.primary_care_unit_id,
    })),
    residents: residentRows.map((resident) => ({
      id: resident.id,
      initials: `${resident.first_name[0] ?? ""}${resident.last_name[0] ?? ""}`.toUpperCase(),
      name: `${resident.first_name} ${resident.last_name}`,
      room: resident.room,
      careUnitId: resident.care_unit_id,
      group: resident.care_unit_name,
      status: resident.flag,
      tone: ["stable", "attention", "critical", "info"].includes(resident.tone) ? resident.tone : "info",
    })),
    settings: resolveSettings(profile.app_settings),
    terminology: resolveTerminology(profile.terminology),
    country: countryCode(profile.country),
    hiddenVitals: Array.isArray(profile.hidden_vitals)
      ? (profile.hidden_vitals as unknown[]).filter((key): key is string => typeof key === "string")
      : [],
    preferences: resolvePreferences(profile.user_preferences),
  };
}

export async function updateWorkContext(
  userId: string,
  input: { primaryCareUnitId?: string; jobTitle?: string; phone?: string },
) {
  const sql = database();
  if (input.primaryCareUnitId !== undefined) {
    const units =
      (await sql`SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id JOIN carecore_user_profiles p ON p.organization_id = si.organization_id AND p.user_id = ${userId} WHERE cu.id = ${input.primaryCareUnitId} AND cu.active = TRUE LIMIT 1`) as unknown as Array<{
        id: string;
      }>;
    if (!units[0]) throw new Error("CARE_UNIT_NOT_FOUND");
    await sql`UPDATE carecore_user_profiles SET primary_care_unit_id = ${input.primaryCareUnitId}, updated_at = NOW() WHERE user_id = ${userId}`;
    await sql`UPDATE carecore_user_unit_assignments SET is_primary = FALSE WHERE user_id = ${userId}`;
    await sql`INSERT INTO carecore_user_unit_assignments (user_id, care_unit_id, assignment_role, is_primary) VALUES (${userId}, ${input.primaryCareUnitId}, 'Mitarbeitende:r', TRUE) ON CONFLICT (user_id, care_unit_id) DO UPDATE SET is_primary = TRUE, ends_on = NULL`;
  }
  if (input.jobTitle !== undefined || input.phone !== undefined)
    await sql`UPDATE carecore_user_profiles SET job_title = COALESCE(${input.jobTitle ?? null}, job_title), phone = COALESCE(${input.phone ?? null}, phone), updated_at = NOW() WHERE user_id = ${userId}`;
  return getWorkContext(userId);
}
