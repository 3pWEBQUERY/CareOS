import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "@/lib/api-context";

export type HealthReport = {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  database: { reachable: boolean; latencyMs: number | null };
  migrations: { applied: number; latest: string | null; pending: string[] | null };
};

// Migrationsdateien im Deployment; fehlt der Ordner (z. B. nicht mitgeliefert), bleibt der Abgleich offen.
async function migrationFiles(dir = path.join(process.cwd(), "database", "migrations")) {
  try {
    return (await readdir(dir)).filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name)).sort();
  } catch {
    return null;
  }
}

// Zustand für Überwachung und Load-Balancer: Datenbank erreichbar, Migrationsstand. Keine Geheimnisse,
// keine Personendaten, keine Fehlermeldungen der Datenbank.
export async function healthReport(sql: Sql, files?: string[] | null): Promise<HealthReport> {
  const checkedAt = new Date().toISOString();
  const started = performance.now();
  let rows: Array<{ version: string }>;
  try {
    rows = (await sql`SELECT version FROM carecore_schema_migrations ORDER BY version`) as Array<{ version: string }>;
  } catch {
    return {
      status: "down",
      checkedAt,
      database: { reachable: false, latencyMs: null },
      migrations: { applied: 0, latest: null, pending: null },
    };
  }
  const latencyMs = Math.round(performance.now() - started);
  const expected = files === undefined ? await migrationFiles() : files;
  const applied = new Set(rows.map((row) => String(row.version)));
  const pending = expected ? expected.filter((file) => !applied.has(file)) : null;
  return {
    status: pending?.length ? "degraded" : "ok",
    checkedAt,
    database: { reachable: true, latencyMs },
    migrations: { applied: rows.length, latest: rows.at(-1)?.version ?? null, pending },
  };
}
