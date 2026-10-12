import { NextResponse } from "next/server";
import { readTerms } from "@/lib/settings";
import { toCsv } from "@/lib/roster/csv";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { raiWorkplace } from "@/lib/rai";
import { RAI_STATE } from "@/lib/rai-shared";

export const runtime = "nodejs";

// Bericht des Kompass als CSV (Semikolon getrennt, öffnet direkt in Excel).
export async function GET() {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    const [{ residents }, t] = await Promise.all([raiWorkplace(ctx), readTerms(ctx)]);
    const lines = [
      [
        t.one,
        "Zimmer",
        "Wohnbereich",
        "Status",
        "Grund",
        "Fällig am",
        "Fortschritt %",
        "Instrument",
        "Verantwortlich",
        "Letzter Abschluss",
        "Bereiche mit Handlungsbedarf",
      ],
      ...residents.map((row) => [
        row.name,
        row.room,
        row.unit,
        RAI_STATE[row.state].label,
        row.reason,
        row.dueOn,
        row.progress,
        row.instrument,
        row.assessor,
        row.lastCompletedOn,
        row.needs,
      ]),
    ];
    const csv = toCsv(lines);
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="kompass-bericht-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Der Bericht konnte nicht erstellt werden.");
  }
}
