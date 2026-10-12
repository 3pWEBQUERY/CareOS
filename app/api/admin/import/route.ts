import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse, ApiError } from "@/lib/api-context";
import { toCsv } from "@/lib/csv-import";
import { IMPORT_COLUMNS, commitImport, previewImport, type ImportKind } from "@/lib/data-import";

export const runtime = "nodejs";

const kindOf = (value: unknown): ImportKind => {
  if (value === "residents" || value === "staff") return value;
  throw new ApiError("Unbekannte Art der Datenübernahme.");
};

// Vorlage als CSV (nur Kopfzeile, Semikolon, für Excel).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const kind = kindOf(new URL(request.url).searchParams.get("kind"));
    return new NextResponse(toCsv([IMPORT_COLUMNS[kind].map((column) => column.label)]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="carecore-vorlage-${kind === "residents" ? "bewohner" : "mitarbeitende"}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Die Vorlage konnte nicht erstellt werden.");
  }
}

// { kind, csv, commit }: ohne commit nur die Vorschau mit Prüfung je Zeile, mit commit die Übernahme.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { kind?: unknown; csv?: unknown; commit?: unknown };
    const kind = kindOf(body.kind);
    const csv = typeof body.csv === "string" ? body.csv : "";
    return NextResponse.json(
      body.commit === true ? await commitImport(ctx, kind, csv) : await previewImport(ctx, kind, csv),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "Die Datenübernahme ist fehlgeschlagen.");
  }
}
