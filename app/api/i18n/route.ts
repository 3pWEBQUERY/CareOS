import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { releasedLanguages } from "@/lib/languages";
import { carecoreActor, carecoreDb, hasPermission } from "@/lib/server-data";
import { LANGUAGE_KEYS } from "@/lib/i18n-shared";

export const runtime = "nodejs";

// Wählbare Sprachen: freigegebene für alle (auch Anmeldung und Portal), zum Prüfen alle für die Administration.
export async function GET() {
  try {
    const actor = await carecoreActor().catch(() => null);
    const languages = hasPermission(actor, "administration.manage")
      ? LANGUAGE_KEYS
      : await releasedLanguages(carecoreDb());
    return NextResponse.json({ languages });
  } catch (error) {
    return apiErrorResponse(error, "Sprachen konnten nicht geladen werden.");
  }
}
