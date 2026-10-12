import { test, after } from "node:test";
import assert from "node:assert/strict";
import { apiErrorResponse, ApiError } from "@/lib/api-context";
import { checkErrorAlert, errorSummary } from "@/lib/error-log";
import { carecoreDb } from "@/lib/server-data";
import { q } from "../support/db";
import { startMockSmtp } from "../support/mock-smtp.mjs";

const smtp = await startMockSmtp(0);
after(() => smtp.close());

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

test("Überwachung: Serverfehler festhalten, Zusammenfassung, Alarm höchstens einmal je Stunde", async () => {
  await q(`DELETE FROM carecore_error_events`);
  await q(`DELETE FROM carecore_error_alerts`);
  const sql = carecoreDb();

  // Fachliche Ablehnungen (ApiError) sind keine Serverfehler.
  apiErrorResponse(new ApiError("Bitte Namen eingeben."), "Speichern fehlgeschlagen.");
  // Nur die erste Zeile, gekürzt, mit Fehlerart und Datenbank-Code.
  const failure = Object.assign(new Error(`Verbindung verloren\nZeile 2 mit Details`), { code: "57P01" });
  apiErrorResponse(failure, "Dokumentation konnte nicht gespeichert werden.");
  await settle();
  const summary = await errorSummary(sql);
  assert.equal(summary.last24h, 1);
  assert.equal(summary.recent[0].source, "Dokumentation konnte nicht gespeichert werden.");
  assert.equal(summary.recent[0].errorName, "Error");
  assert.equal(summary.recent[0].detail, "[57P01] Verbindung verloren");

  // Ohne ALERT_EMAIL und E-Mail-Versand kein Alarm.
  assert.deepEqual(await checkErrorAlert(sql), { alerted: false });

  process.env.ALERT_EMAIL = "betrieb@carecore.test";
  process.env.ALERT_ERROR_THRESHOLD = "3";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(smtp.port);
  process.env.MAIL_FROM = "CareOS <noreply@carecore.test>";
  process.env.APP_URL = "https://carecore.test";
  // Unter der Schwelle: kein Alarm.
  assert.deepEqual(await checkErrorAlert(sql), { alerted: false });
  for (let i = 0; i < 3; i++) apiErrorResponse(new Error(`Fehler ${i}`), "Aufgaben konnten nicht geladen werden.");
  await settle();
  assert.deepEqual(await checkErrorAlert(sql), { alerted: true, count: 4 });
  const [mail] = smtp.messages.filter((message) => message.to.includes("betrieb@carecore.test"));
  assert.match(mail.subject, /4 Serverfehler in 15 Minuten/);
  assert.match(mail.body, /https:\/\/carecore\.test\/c\/leitung\/administration\/konfiguration/);
  // Innerhalb einer Stunde kein zweiter Alarm.
  assert.deepEqual(await checkErrorAlert(sql), { alerted: false });

  // Aufräumen nach 30 Tagen.
  await q(`UPDATE carecore_error_events SET occurred_at = NOW() - INTERVAL '31 days'`);
  await checkErrorAlert(sql);
  assert.equal((await errorSummary(sql)).recent.length, 0);
});
