import { NextResponse } from "next/server";
import { healthReport, type HealthReport } from "@/lib/health";
import { carecoreDb } from "@/lib/server-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Öffentlicher Zustand für Überwachung: 200 bei „ok“ oder „degraded“ (ausstehende Migrationen), 503 ohne Datenbank.
export async function GET() {
  let report: HealthReport;
  try {
    report = await healthReport(carecoreDb());
  } catch {
    // Keine Datenbank konfiguriert.
    report = {
      status: "down",
      checkedAt: new Date().toISOString(),
      database: { reachable: false, latencyMs: null },
      migrations: { applied: 0, latest: null, pending: null },
    };
  }
  return NextResponse.json(report, {
    status: report.status === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
