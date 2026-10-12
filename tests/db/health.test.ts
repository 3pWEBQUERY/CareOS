import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import type { Sql } from "@/lib/api-context";
import { healthReport } from "@/lib/health";
import { apiContextFor, fixture } from "../support/db";

test("Health: Datenbank erreichbar, Migrationsstand und ausstehende Migrationen", async () => {
  const { sql } = await apiContextFor(await fixture(), "anna");
  const files = (await readdir("database/migrations")).filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name)).sort();

  const ok = await healthReport(sql);
  assert.equal(ok.status, "ok");
  assert.equal(ok.database.reachable, true);
  assert.ok((ok.database.latencyMs ?? -1) >= 0);
  assert.equal(ok.migrations.latest, files.at(-1));
  assert.deepEqual(ok.migrations.pending, []);

  // Eine neue Datei ohne angewendete Migration macht den Zustand „degraded“.
  const pending = await healthReport(sql, [...files, "9999_future.sql"]);
  assert.equal(pending.status, "degraded");
  assert.deepEqual(pending.migrations.pending, ["9999_future.sql"]);

  // Ohne Migrationsordner bleibt der Abgleich offen.
  assert.equal((await healthReport(sql, null)).migrations.pending, null);

  // Datenbank nicht erreichbar: „down“, ohne Fehlermeldung der Datenbank.
  const broken = (() => Promise.reject(new Error("connection refused: secret-host"))) as unknown as Sql;
  const down = await healthReport(broken);
  assert.equal(down.status, "down");
  assert.equal(down.database.reachable, false);
  assert.ok(!JSON.stringify(down).includes("secret-host"));
});
