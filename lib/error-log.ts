import { carecoreDb } from "@/lib/server-data";
import { linkMail, mailConfigured, sendMail } from "@/lib/mail";
import type { Sql } from "@/lib/api-context";

// Überwachung: Serverfehler (HTTP 500) werden kurz festgehalten und erscheinen in Leitung › Konfiguration ›
// Systemstatus. Gespeichert werden nur Herkunft, Fehlerart und die erste Zeile der Meldung (gekürzt), nie
// Anfragedaten. Das Festhalten darf nie selbst einen Fehler auslösen.

const firstLine = (value: string) => value.split("\n")[0].trim().slice(0, 300);

export function recordServerError(source: string, error: unknown) {
  try {
    const name = error instanceof Error ? error.name : typeof error;
    const detail = error instanceof Error ? firstLine(error.message) : firstLine(String(error));
    const code = (error as { code?: unknown } | null)?.code;
    void carecoreDb()`
      INSERT INTO carecore_error_events (source, error_name, detail)
      VALUES (${source.slice(0, 200)}, ${String(name).slice(0, 80)}, ${typeof code === "string" ? `[${code}] ${detail}`.slice(0, 300) : detail})`.catch(
      () => undefined,
    );
  } catch {
    // Ohne Datenbank (z. B. DATABASE_URL fehlt) bleibt es beim Server-Log.
  }
}

export type ErrorSummary = {
  last24h: number;
  recent: Array<{ at: string; source: string; errorName: string; detail: string }>;
};

export async function errorSummary(sql: Sql): Promise<ErrorSummary> {
  const [count, recent] = await Promise.all([
    sql`SELECT COUNT(*)::int AS n FROM carecore_error_events WHERE occurred_at > NOW() - INTERVAL '24 hours'`,
    sql`SELECT occurred_at, source, error_name, detail FROM carecore_error_events ORDER BY occurred_at DESC LIMIT 5`,
  ]);
  return {
    last24h: Number(count[0]?.n ?? 0),
    recent: recent.map((row) => ({
      at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
      source: String(row.source),
      errorName: String(row.error_name),
      detail: String(row.detail),
    })),
  };
}

// Alarm per E-Mail an ALERT_EMAIL, wenn in den letzten 15 Minuten mindestens ALERT_ERROR_THRESHOLD Serverfehler
// auftraten (technische Schwelle, Standard 10); höchstens ein Alarm je Stunde. Läuft mit dem Zeitplan
// (/api/push/dispatch) und räumt Einträge älter als 30 Tage auf.
export async function checkErrorAlert(sql: Sql, now = new Date()) {
  await sql`DELETE FROM carecore_error_events WHERE occurred_at < NOW() - INTERVAL '30 days'`;
  const to = process.env.ALERT_EMAIL?.trim();
  if (!to || !mailConfigured()) return { alerted: false };
  const configured = Number(process.env.ALERT_ERROR_THRESHOLD);
  const threshold = Number.isInteger(configured) && configured > 0 ? configured : 10;
  const [row] = await sql`
    SELECT COUNT(*)::int AS n,
      (SELECT MAX(sent_at) FROM carecore_error_alerts) AS last_alert
    FROM carecore_error_events WHERE occurred_at > NOW() - INTERVAL '15 minutes'`;
  const count = Number(row?.n ?? 0);
  const lastAlert = row?.last_alert ? new Date(String(row.last_alert)) : null;
  if (count < threshold || (lastAlert && now.getTime() - lastAlert.getTime() < 60 * 60 * 1000))
    return { alerted: false };
  await sql`INSERT INTO carecore_error_alerts (sent_at, error_count) VALUES (NOW(), ${count})`;
  const url = `${process.env.APP_URL?.trim() || `https://${process.env.RAILWAY_PUBLIC_DOMAIN ?? ""}`}/c/leitung/administration/konfiguration`;
  await sendMail({
    to,
    subject: `CareOS: ${count} Serverfehler in 15 Minuten`,
    ...linkMail({
      heading: "Viele Serverfehler",
      intro: `In den letzten 15 Minuten sind ${count} Serverfehler aufgetreten (Schwelle ${threshold}). Bitte das Log des Dienstes und den Systemstatus prüfen.`,
      action: "Systemstatus öffnen",
      url,
      note: "Der nächste Alarm kommt frühestens in einer Stunde.",
    }),
  });
  return { alerted: true, count };
}
