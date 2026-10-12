import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { timesheetCsv } from "@/lib/roster/export-service";

export const runtime = "nodejs";

// CSV-Download der Arbeitszeit (?art=summen|eintraege, Filter wie /api/dienstplan/time).
export async function GET(request: Request) {
  try {
    const { filename, body } = await timesheetCsv(await rosterContext(), new URL(request.url).searchParams);
    return new Response(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return respond(async () => {
      throw error;
    }, "Der Export konnte nicht erstellt werden.");
  }
}
