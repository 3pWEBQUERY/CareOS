import { ApiError, type ApiContext } from "./api-context";

// Kennung einer wiederholbaren Anfrage (Offline-Warteschlange), mitgeschickt im Header.
export const REQUEST_ID_HEADER = "x-carecore-request-id";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestIdFrom(request: Request) {
  const value = request.headers.get(REQUEST_ID_HEADER);
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

// Quittung für `ctx.sql.transaction([...])`: Wurde die Anfrage bereits verarbeitet, scheitert die ganze
// Transaktion am Primärschlüssel und es entsteht kein zweiter Eintrag (siehe isRepeatedRequest).
// Quittungen werden nur gebraucht, solange offline erfasste Einträge nachgereicht werden können (höchstens 7 Tage
// rückwirkend); nach 30 Tagen werden sie bei der nächsten Quittung entfernt.
export const RECEIPT_RETENTION_DAYS = 30;

export function receiptStatements(ctx: ApiContext, requestId: string | null) {
  return requestId
    ? [
        ctx.sql`INSERT INTO carecore_request_receipts (id, user_id) VALUES (${requestId}, ${ctx.actor.id})`,
        ctx.sql`DELETE FROM carecore_request_receipts WHERE created_at < NOW() - make_interval(days => ${RECEIPT_RETENTION_DAYS})`,
      ]
    : [];
}

export const isRepeatedRequest = (error: unknown) => String(error).includes("carecore_request_receipts_pkey");

// Führt eine Transaktion mit Quittung aus; eine bereits verarbeitete Anfrage gilt als erfolgreich.
export async function withReceipt(run: () => Promise<unknown>) {
  try {
    await run();
    return { repeated: false };
  } catch (error) {
    if (isRepeatedRequest(error)) return { repeated: true };
    throw error;
  }
}

// Zeitpunkt einer offline erfassten Aktion (z. B. Übergabepunkt, erledigte Aufgabe): höchstens `maxDaysBack` Tage
// zurück und nicht in der Zukunft; ohne Angabe gilt „jetzt“.
export function capturedAt(value: unknown, maxDaysBack = 3) {
  if (value === undefined || value === null || value === "") return null;
  const at = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new ApiError("Ungültiger Zeitpunkt.");
  if (at.getTime() > Date.now() + 5 * 60_000) throw new ApiError("Der Zeitpunkt liegt in der Zukunft.");
  if (at.getTime() < Date.now() - maxDaysBack * 86_400_000)
    throw new ApiError(`Einträge können höchstens ${maxDaysBack} Tage rückwirkend erfasst werden.`);
  return at.toISOString();
}
