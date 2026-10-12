// Postgres ohne Neon: Der Neon-Treiber (`neon()` aus @neondatabase/serverless) schickt Abfragen per HTTP an Neon.
// Für eine gewöhnliche Postgres-Datenbank (z. B. Railway) beantwortet diese Funktion dieselben Anfragen über einen
// Verbindungspool (pg). Rückgabe im Format der Neon-HTTP-Schnittstelle (Werte als Text, Typen je Feld), damit der
// Treiber sie genau wie bei Neon umwandelt; Transaktionen (`sql.transaction`) laufen in BEGIN … COMMIT.
import pg from "pg";
import { neonConfig } from "@neondatabase/serverless";

const raw = (value) => value;
const types = { getTypeParser: () => raw };

const pools = (globalThis.__carecorePgPools ??= new Map());
function poolFor(connectionString) {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new pg.Pool({ connectionString, types, max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
    pool.on("error", (error) => console.error("Postgres pool error", error.message));
    pools.set(connectionString, pool);
  }
  return pool;
}

const format = (result) => ({
  command: result.command,
  rowCount: result.rowCount,
  fields: result.fields.map((field) => ({
    name: field.name,
    dataTypeID: field.dataTypeID,
    tableID: field.tableID,
    columnID: field.columnID,
    dataTypeSize: field.dataTypeSize,
    dataTypeModifier: field.dataTypeModifier,
    format: "text",
  })),
  rows: result.rows,
  rowAsArray: true,
});

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function pgFetch(input, init) {
  const headers = new Headers(init?.headers);
  const connectionString = headers.get("Neon-Connection-String");
  if (!connectionString) return fetch(input, init);
  const payload = JSON.parse(init?.body ?? "{}");
  const client = await poolFor(connectionString).connect();
  try {
    if (payload.queries) {
      await client.query("BEGIN");
      const results = [];
      for (const query of payload.queries)
        results.push(format(await client.query({ text: query.query, values: query.params, rowMode: "array", types })));
      await client.query("COMMIT");
      return reply(200, { results });
    }
    return reply(
      200,
      format(await client.query({ text: payload.query, values: payload.params, rowMode: "array", types })),
    );
  } catch (error) {
    if (payload.queries) await client.query("ROLLBACK").catch(() => {});
    return reply(400, {
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      severity: error.severity,
    });
  } finally {
    client.release();
  }
}

// Neon-Datenbanken (*.neon.tech) und die Testumgebung (neon.test) bleiben beim HTTP-Treiber; jede andere
// Postgres-Datenbank läuft über den Pool.
export function usesPg(connectionString) {
  try {
    const host = new URL(connectionString).hostname;
    return !host.endsWith(".neon.tech") && host !== "neon.test";
  } catch {
    return false;
  }
}

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (url && usesPg(url)) neonConfig.fetchFunction = pgFetch;
