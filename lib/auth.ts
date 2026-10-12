import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";
import "@/database/pg-fetch.mjs";
import { COUNTRY_CODES, type CountryCode } from "@/lib/country";

export const SESSION_COOKIE = "carecore_session";
const SESSION_DAYS = 7;
const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000001";
const MIN_ADMIN_PASSWORD_LENGTH = 12;
// Formerly shipped default admin hash. Kept only to detect and block accounts that still use it.
const LEGACY_DEFAULT_ADMIN_HASH =
  "scrypt:01a0fdc66a4455589c11381adeb7f306:653cb4f3ad74171c86dd33e71582ab3cca7c7f75734302e64fac4cc60c99033911bb3f981397df4e0049ccbc72a1d40adf5824bcb710ee1e4c8c4ea537ba372f";
const LOGIN_WINDOW_MINUTES = 15;
const MAX_FAILED_LOGINS_PER_USERNAME = 5;
const MAX_FAILED_LOGINS_PER_IP = 20;
const scrypt = promisify(scryptCallback);

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  password_hash: string;
};

// Mit Sitzung und Gerät der Anmeldung, damit Protokolleinträge ihre Herkunft festhalten.
export type AuthenticatedUser = Omit<UserRow, "password_hash"> & { session_id?: string; user_agent?: string | null };

let bootstrapPromise: Promise<void> | null = null;

function database() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  return neon(connectionString);
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [algorithm, salt, storedHash] = encodedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !storedHash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const stored = Buffer.from(storedHash, "hex");
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

// Creates the initial admin (or replaces the formerly shipped default password)
// from CARECORE_ADMIN_PASSWORD. Without that variable no admin is seeded.
async function bootstrapAdmin(sql: ReturnType<typeof database>) {
  const password = process.env.CARECORE_ADMIN_PASSWORD;
  if (!password) return;
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    console.error(
      `CARECORE_ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters; admin bootstrap skipped.`,
    );
    return;
  }
  const passwordHash = await hashPassword(password);
  await sql`
    INSERT INTO carecore_users (id, username, display_name, role, password_hash)
    VALUES (${ADMIN_USER_ID}, 'Admin', 'CareOS Administrator', 'admin', ${passwordHash})
    ON CONFLICT DO NOTHING
  `;
  await sql`UPDATE carecore_users SET password_hash = ${passwordHash}, updated_at = NOW() WHERE password_hash = ${LEGACY_DEFAULT_ADMIN_HASH}`;
  await ensureAdminOrganization(sql);
}

// On an empty database, create the organization with one site and care unit so
// the admin can start working; an existing organization is only assigned.
async function ensureAdminOrganization(sql: ReturnType<typeof database>) {
  const organizationName = process.env.CARECORE_ORGANIZATION_NAME?.trim().slice(0, 180) || "CareOS";
  // Land aus der Installation (CARECORE_COUNTRY = CH, DE oder AT); ohne Angabe die Schweiz, noch nicht bestätigt.
  const countryInput = process.env.CARECORE_COUNTRY?.trim().toUpperCase();
  const country = COUNTRY_CODES.includes(countryInput as CountryCode) ? (countryInput as CountryCode) : null;
  const organizationId = randomUUID();
  const siteId = randomUUID();
  await sql.transaction([
    sql`INSERT INTO carecore_organizations (id, name, country, country_set_at)
      SELECT ${organizationId}, ${organizationName}, ${country ?? "CH"}, ${country ? new Date().toISOString() : null}::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM carecore_organizations)`,
    sql`INSERT INTO carecore_sites (id, organization_id, name) SELECT ${siteId}, ${organizationId}, ${organizationName} WHERE EXISTS (SELECT 1 FROM carecore_organizations WHERE id = ${organizationId})`,
    sql`INSERT INTO carecore_care_units (id, site_id, name) SELECT ${randomUUID()}, ${siteId}, 'Wohnbereich 1' WHERE EXISTS (SELECT 1 FROM carecore_sites WHERE id = ${siteId})`,
    sql`
      INSERT INTO carecore_user_profiles (user_id, organization_id, job_title)
      VALUES (${ADMIN_USER_ID}, (SELECT id FROM carecore_organizations ORDER BY created_at LIMIT 1), 'CareOS Administrator')
      ON CONFLICT (user_id) DO UPDATE SET organization_id = COALESCE(carecore_user_profiles.organization_id, EXCLUDED.organization_id)`,
  ]);
}

// Tables are created by database/migrations; only the admin bootstrap runs here, once per process.
async function ensureAdminBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapAdmin(database()).catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  await bootstrapPromise;
}

export async function authenticate(username: string, password: string): Promise<AuthenticatedUser | null> {
  await ensureAdminBootstrap();
  const sql = database();
  const rows = (await sql`
    SELECT id, username, display_name, role, password_hash
    FROM carecore_users
    WHERE LOWER(username) = LOWER(${username.trim()}) AND active = TRUE
    LIMIT 1
  `) as unknown as UserRow[];
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) return null;
  if (user.password_hash === LEGACY_DEFAULT_ADMIN_HASH) {
    console.warn(
      `Login for "${user.username}" blocked: account still uses the former default password. Set CARECORE_ADMIN_PASSWORD to replace it.`,
    );
    return null;
  }
  const { password_hash: _passwordHash, ...safeUser } = user;
  void _passwordHash;
  return safeUser;
}

export async function createSession(userId: string, userAgent?: string | null) {
  const sql = database();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql`DELETE FROM carecore_sessions WHERE expires_at <= NOW()`;
  await sql`
    INSERT INTO carecore_sessions (id, token_hash, user_id, expires_at, user_agent)
    VALUES (${randomUUID()}, ${hashSessionToken(token)}, ${userId}, ${expiresAt.toISOString()}, ${userAgent?.slice(0, 300) ?? null})
  `;
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const sql = database();
  const rows = (await sql`
    SELECT u.id, u.username, u.display_name, u.role, s.id AS session_id, s.user_agent
    FROM carecore_sessions s
    JOIN carecore_users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashSessionToken(token)}
      AND s.expires_at > NOW()
      AND u.active = TRUE
    LIMIT 1
  `) as unknown as AuthenticatedUser[];
  return rows[0] ?? null;
}

export async function deleteSession(token: string | undefined) {
  if (!token) return;
  const sql = database();
  await sql`DELETE FROM carecore_sessions WHERE token_hash = ${hashSessionToken(token)}`;
}

function usernameKey(username: string) {
  return username.trim().toLowerCase().slice(0, 80);
}

export async function isLoginThrottled(username: string, ipAddress: string) {
  const sql = database();
  const rows = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE username_key = ${usernameKey(username)})::int AS by_username,
      COUNT(*) FILTER (WHERE ip_address = ${ipAddress})::int AS by_ip
    FROM carecore_login_attempts
    WHERE attempted_at > NOW() - make_interval(mins => ${LOGIN_WINDOW_MINUTES})
  `) as unknown as Array<{ by_username: number; by_ip: number }>;
  const counts = rows[0];
  return !!counts && (counts.by_username >= MAX_FAILED_LOGINS_PER_USERNAME || counts.by_ip >= MAX_FAILED_LOGINS_PER_IP);
}

export async function recordFailedLogin(username: string, ipAddress: string) {
  const sql = database();
  await sql`DELETE FROM carecore_login_attempts WHERE attempted_at <= NOW() - make_interval(mins => ${LOGIN_WINDOW_MINUTES})`;
  await sql`
    INSERT INTO carecore_login_attempts (id, username_key, ip_address)
    VALUES (${randomUUID()}, ${usernameKey(username)}, ${ipAddress.slice(0, 64)})
  `;
}

export async function clearFailedLogins(username: string) {
  const sql = database();
  await sql`DELETE FROM carecore_login_attempts WHERE username_key = ${usernameKey(username)}`;
}
