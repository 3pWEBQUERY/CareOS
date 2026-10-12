import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import {
  draftTranslations,
  languageStates,
  listTranslations,
  reviewTranslations,
  saveTranslation,
  setLanguageReleased,
} from "@/lib/translations";

export const runtime = "nodejs";
// KI-Entwürfe für bis zu 200 Texte brauchen etwas Zeit.
export const maxDuration = 300;

// Übersicht der Sprachen und Texte einer Sprache (50 je Seite, gefiltert).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    const languages = await languageStates(ctx.sql);
    if (!params.get("locale")) return NextResponse.json({ languages });
    return NextResponse.json({
      languages,
      ...(await listTranslations(ctx, {
        locale: params.get("locale"),
        filter: params.get("filter"),
        query: params.get("q"),
        offset: params.get("offset"),
      })),
    });
  } catch (error) {
    return apiErrorResponse(error, "Übersetzungen konnten nicht geladen werden.");
  }
}

// Eine Übersetzung speichern (optional als geprüft).
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    await saveTranslation(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Übersetzung konnte nicht gespeichert werden.");
  }
}

// { action: "draft" | "review" | "release", locale, … }
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "draft") return NextResponse.json(await draftTranslations(ctx, body.locale));
    if (body.action === "review")
      return NextResponse.json({ reviewed: await reviewTranslations(ctx, body.locale, body.sources) });
    if (body.action === "release") {
      await setLanguageReleased(ctx, body.locale, body.released === true);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unbekannte Aktion." }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, "Die Aktion ist fehlgeschlagen.");
  }
}
