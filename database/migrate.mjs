// Applies pending SQL migrations from database/migrations in filename order.
// Each migration runs in one transaction together with its bookkeeping row, so
// it is either fully applied or not at all.
//
// Usage: node --env-file=.env.local database/migrate.mjs [--dry-run]
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import "./pg-fetch.mjs";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);
const LOCK_KEY = 7_302_411; // arbitrary constant shared by all migration runs
const dryRun = process.argv.includes("--dry-run");

// Preview deployments share the database with production, so only production
// builds (or runs outside Vercel) may change the schema.
if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  console.log(`Skipping migrations for Vercel environment "${process.env.VERCEL_ENV}".`);
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL or POSTGRES_URL is required.");
const sql = neon(connectionString);

// Splits a migration at semicolons that end a line, but not inside quoted text or
// dollar-quoted bodies ($$ ... $$), so PL/pgSQL functions stay in one statement.
function splitStatements(source) {
  const text = source.replace(/^--.*$/gm, "");
  const statements = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (text.startsWith(quote, index)) {
        current += quote;
        index += quote.length - 1;
        quote = null;
      } else current += char;
      continue;
    }
    const dollar = char === "$" ? /^\$[A-Za-z_]*\$/.exec(text.slice(index)) : null;
    if (dollar) {
      quote = dollar[0];
      current += quote;
      index += quote.length - 1;
    } else if (char === "'") {
      quote = "'";
      current += char;
    } else if (char === ";" && /^[ \t]*(\r?\n|$)/.test(text.slice(index + 1))) {
      statements.push(current);
      current = "";
    } else current += char;
  }
  statements.push(current);
  return statements.map((statement) => statement.trim()).filter(Boolean);
}

await sql`
  CREATE TABLE IF NOT EXISTS carecore_schema_migrations (
    version VARCHAR(200) PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
const applied = new Map(
  (await sql`SELECT version, checksum FROM carecore_schema_migrations`).map((row) => [row.version, row.checksum]),
);

const files = (await readdir(MIGRATIONS_DIR)).filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name)).sort();
let pending = 0;

for (const file of files) {
  const source = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
  const checksum = createHash("sha256").update(source).digest("hex");
  if (applied.has(file)) {
    if (applied.get(file) !== checksum)
      throw new Error(`Migration ${file} was changed after it was applied. Add a new migration instead.`);
    continue;
  }
  pending += 1;
  const statements = splitStatements(source);
  if (dryRun) {
    console.log(`pending: ${file} (${statements.length} statements)`);
    continue;
  }
  try {
    await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`,
      // Recording first makes a concurrent run fail fast on the primary key instead of re-running the statements.
      sql`INSERT INTO carecore_schema_migrations (version, checksum) VALUES (${file}, ${checksum})`,
      ...statements.map((statement) => sql.query(statement)),
    ]);
    console.log(`applied: ${file} (${statements.length} statements)`);
  } catch (error) {
    if (String(error).includes("carecore_schema_migrations_pkey")) {
      console.log(`skipped: ${file} (applied by a concurrent run)`);
      continue;
    }
    throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : error}`, { cause: error });
  }
}

console.log(pending ? `${dryRun ? "Pending" : "Applied"} ${pending} migration(s).` : "Database schema is up to date.");
