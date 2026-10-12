import { createHash } from "node:crypto";
import type { Sql } from "@/lib/api-context";

// Allgemeine Drossel für schreibende API-Anfragen (POST, PATCH, PUT, DELETE), gezählt je Minute und je Sitzung
// bzw. ohne Anmeldung je IP-Adresse. Die Grenze ist ein technischer Schutz gegen Skripte und Fehlschleifen, kein
// fachlicher Grenzwert; sie lässt sich mit CARECORE_WRITE_LIMIT_PER_MINUTE anpassen.
export const DEFAULT_WRITE_LIMIT_PER_MINUTE = 240;
export const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];

// Eigene Drossel oder Zeitplan: hier nicht zusätzlich zählen.
const EXEMPT = [/^\/api\/auth\/login$/, /^\/api\/push\/dispatch$/];

export function writeLimit() {
  const configured = Number(process.env.CARECORE_WRITE_LIMIT_PER_MINUTE);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_WRITE_LIMIT_PER_MINUTE;
}

export const isThrottledWrite = (method: string, pathname: string) =>
  WRITE_METHODS.includes(method.toUpperCase()) &&
  pathname.startsWith("/api/") &&
  !EXEMPT.some((pattern) => pattern.test(pathname));

// Schlüssel ohne Klartext: Hash des Sitzungs-Tokens, sonst der IP-Adresse.
export function rateLimitKey(sessionToken: string | undefined, ip: string | null) {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 40);
  return sessionToken ? `s:${hash(sessionToken)}` : `ip:${hash(ip || "unbekannt")}`;
}

export type RateLimitResult = { allowed: boolean; count: number; limit: number; retryAfterSeconds: number };

// Zähler der laufenden Minute erhöhen und prüfen; alte Fenster werden gelegentlich aufgeräumt.
export async function consumeWrite(sql: Sql, key: string, limit = writeLimit()): Promise<RateLimitResult> {
  const rows = (await sql`
    INSERT INTO carecore_rate_limits (key, window_start, count)
    VALUES (${key}, date_trunc('minute', NOW()), 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = carecore_rate_limits.count + 1
    RETURNING count, CEIL(EXTRACT(EPOCH FROM (window_start + INTERVAL '1 minute' - NOW())))::int AS retry_after`) as Array<{
    count: number;
    retry_after: number;
  }>;
  if (Math.random() < 0.02)
    await sql`DELETE FROM carecore_rate_limits WHERE window_start < NOW() - INTERVAL '10 minutes'`;
  const count = Number(rows[0]?.count ?? 0);
  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSeconds: Math.max(1, Number(rows[0]?.retry_after ?? 60)),
  };
}
