import type { Row, Sql } from "@/lib/api-context";
import { TARGET_LANGUAGES, type Language } from "@/lib/i18n-shared";

// Freigegebene Sprachen (Deutsch immer). Nur diese können Mitarbeitende und Portal wählen.
export async function releasedLanguages(sql: Sql): Promise<Language[]> {
  const rows = (await sql`SELECT locale FROM carecore_languages WHERE released`) as Row[];
  const released = new Set(rows.map((row) => String(row.locale)));
  return ["de", ...TARGET_LANGUAGES.filter((locale) => released.has(locale))];
}
