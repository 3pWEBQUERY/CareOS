import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { isLanguage } from "@/lib/i18n-shared";
import { releasedLanguages } from "@/lib/languages";
import { carecoreActor, carecoreDb, hasPermission } from "@/lib/server-data";
import { dictionaryFor } from "@/lib/translations";

export const runtime = "nodejs";
type Context = { params: Promise<{ locale: string }> };

// Wörterbuch einer Sprache. Ohne Anmeldung (Anmeldeseite, Portal) nur freigegebene Sprachen mit geprüften Texten;
// die Administration erhält mit ?drafts=1 auch Entwürfe und noch nicht freigegebene Sprachen (zum Prüfen).
export async function GET(request: Request, { params }: Context) {
  try {
    const { locale } = await params;
    if (!isLanguage(locale)) return NextResponse.json({ error: "Unbekannte Sprache." }, { status: 404 });
    const sql = carecoreDb();
    const admin = hasPermission(await carecoreActor().catch(() => null), "administration.manage");
    if (!admin && !(await releasedLanguages(sql)).includes(locale))
      return NextResponse.json({ error: "Diese Sprache ist nicht freigegeben." }, { status: 404 });
    const drafts = admin && new URL(request.url).searchParams.get("drafts") === "1";
    return NextResponse.json(await dictionaryFor(sql, locale, drafts), {
      headers: { "Cache-Control": "private, no-cache" },
    });
  } catch (error) {
    return apiErrorResponse(error, "Die Übersetzung konnte nicht geladen werden.");
  }
}
