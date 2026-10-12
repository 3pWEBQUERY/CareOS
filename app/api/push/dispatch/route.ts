import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { checkErrorAlert } from "@/lib/error-log";
import { runPushSchedule } from "@/lib/push-schedule";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";

// Zeitgesteuerter Aufruf (z. B. Vercel Cron oder ein externer Planer, alle 5–15 Minuten) mit
// `Authorization: Bearer <CRON_SECRET>`: erzeugt fällige Erinnerungen und versendet offene Push-Nachrichten.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET ist nicht gesetzt." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  try {
    const sql = carecoreDb();
    // Überwachung: Alarm bei vielen Serverfehlern; ein Fehler dabei hält den Push-Versand nicht auf.
    const alert = await checkErrorAlert(sql).catch((error) => {
      console.error("Error alert failed", error);
      return { alerted: false };
    });
    return NextResponse.json({ ...(await runPushSchedule(sql)), alert });
  } catch (error) {
    return apiErrorResponse(error, "Push-Versand fehlgeschlagen.");
  }
}
