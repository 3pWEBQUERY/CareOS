import { NextResponse, type NextRequest } from "next/server";
import { toCsv, type CsvValue } from "@/lib/roster/csv";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { kompassStatistics } from "@/lib/kompass";
import { NOT_APPLICABLE_LABEL } from "@/lib/kompass-instrument";

export const runtime = "nodejs";

// Auswertung des Kompass je Wohnbereich (nur gezählt). Mit format=csv als Datei für Excel.
export async function GET(request: NextRequest) {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    const params = request.nextUrl.searchParams;
    const statistics = await kompassStatistics(ctx, params.get("careUnitId"));
    if (params.get("format") !== "csv") return NextResponse.json(statistics);
    const lines: CsvValue[][] = [
      ["Wohnbereich", statistics.careUnit?.name ?? "Ganzes Haus"],
      ["Personen", statistics.people],
      ["Mit abgeschlossener Abklärung", statistics.assessed],
      [],
      ["Bereich", "Frage", "Antwort", "Personen"],
    ];
    for (const domain of statistics.domains) {
      lines.push([domain.title, "Unterstützung oder Beobachtung", "", domain.withSupport]);
      lines.push([domain.title, "Handlungsbedarf festgehalten", "", domain.withNeed]);
      for (const item of domain.items) {
        for (const count of item.counts) lines.push([domain.title, item.label, count.label, count.count]);
        if (item.notApplicable) lines.push([domain.title, item.label, NOT_APPLICABLE_LABEL, item.notApplicable]);
      }
    }
    return new NextResponse(toCsv(lines), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="kompass-auswertung-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Die Auswertung konnte nicht erstellt werden.");
  }
}
