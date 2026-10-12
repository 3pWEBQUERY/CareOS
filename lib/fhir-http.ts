import { NextResponse } from "next/server";
import type { Row } from "@/lib/api-context";
import { authenticateApiKey, logApiAccess, type ApiClient } from "@/lib/api-keys";
import type { ApiScope } from "@/lib/api-keys-shared";
import { carecoreDb } from "@/lib/server-data";
import { FHIR_CONTENT_TYPE, FhirError, operationOutcome, searchBundle } from "@/lib/fhir";

type Sql = ReturnType<typeof carecoreDb>;

export const fhirJson = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Content-Type": FHIR_CONTENT_TYPE, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

export const fhirBase = (request: Request) => `${new URL(request.url).origin}/api/fhir/r4`;

// Schlüssel prüfen, Abfrage ausführen, Zugriff protokollieren; Fehler als OperationOutcome.
async function handle(
  request: Request,
  scope: ApiScope,
  resource: string,
  run: (sql: Sql, client: ApiClient) => Promise<{ body: unknown; count: number }>,
) {
  try {
    const sql = carecoreDb();
    const client = await authenticateApiKey(sql, request.headers.get("authorization"), scope);
    if ("status" in client) {
      const response = fhirJson(
        operationOutcome(client.message, client.status === 401 ? "login" : "forbidden"),
        client.status,
      );
      if (client.status === 401) response.headers.set("WWW-Authenticate", 'Bearer realm="CareOS FHIR"');
      return response;
    }
    const { body, count } = await run(sql, client);
    await logApiAccess(sql, client, resource, new URL(request.url).search, count);
    return fhirJson(body);
  } catch (error) {
    if (error instanceof FhirError) return fhirJson(operationOutcome(error.message, error.code), error.status);
    console.error("FHIR request failed", error);
    return fhirJson(operationOutcome("Anfrage konnte nicht verarbeitet werden.", "exception"), 500);
  }
}

export const fhirRead = (
  request: Request,
  scope: ApiScope,
  type: string,
  id: string,
  read: (sql: Sql, client: ApiClient, id: string) => Promise<Row>,
  map: (row: Row) => unknown,
) =>
  handle(request, scope, `${type}/${id}`, async (sql, client) => ({
    body: map(await read(sql, client, id)),
    count: 1,
  }));

export const fhirSearch = (
  request: Request,
  scope: ApiScope,
  type: string,
  search: (
    sql: Sql,
    client: ApiClient,
    params: URLSearchParams,
  ) => Promise<{ total: number; entries: Row[]; count: number; offset: number }>,
  map: (row: Row) => unknown,
) =>
  handle(request, scope, type, async (sql, client) => {
    const params = new URL(request.url).searchParams;
    const result = await search(sql, client, params);
    return { body: searchBundle(fhirBase(request), type, params, result, map), count: result.entries.length };
  });
