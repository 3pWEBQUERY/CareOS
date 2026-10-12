// Integration tests: answers the Neon HTTP driver's requests from a real Postgres
// (TEST_DATABASE_URL), so constraints, triggers and transactions are exercised as in
// production. Loaded with --import before the tests.
import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required for the database tests.");
process.env.DATABASE_URL = "postgresql://test:test@neon.test/carecore";

const raw = (value) => value;
const types = { getTypeParser: () => raw };
export const pool = new pg.Pool({ connectionString: url, types, max: 8 });
pool.on("error", () => {});

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

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const target = typeof input === "string" ? input : (input?.url ?? String(input));
  const headers = new Headers(init?.headers);
  if (!target.endsWith("/sql") || !headers.has("Neon-Connection-String")) return originalFetch(input, init);
  const payload = JSON.parse(init?.body ?? "{}");
  const client = await pool.connect();
  try {
    if (payload.queries) {
      await client.query("BEGIN");
      const results = [];
      for (const query of payload.queries)
        results.push(format(await client.query({ text: query.query, values: query.params, rowMode: "array", types })));
      await client.query("COMMIT");
      return reply(200, { results });
    }
    const result = await client.query({ text: payload.query, values: payload.params, rowMode: "array", types });
    return reply(200, format(result));
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
};
