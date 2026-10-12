import catalog from "@/locales/catalog.json" with { type: "json" };
import { ApiError, auditStatement, iso, type ApiContext, type Row, type Sql } from "@/lib/api-context";
import { MistralError, mistralConfigured, mistralJson, mistralModel } from "@/lib/mistral";
import { hasPermission } from "@/lib/server-data";
import { releasedLanguages } from "@/lib/languages";
import {
  LANGUAGES,
  TARGET_LANGUAGES,
  type Dictionary,
  type Language,
  type LanguageState,
  type TranslationEntry,
  type TranslationStatus,
} from "@/lib/i18n-shared";

// Übersetzungen der Oberfläche. Ausgangstexte stehen im Katalog (locales/catalog.json, aus dem Code gesammelt); die
// Übersetzungen liegen in der Datenbank mit Prüfstatus. Mitarbeitende erhalten nur geprüfte Übersetzungen einer
// freigegebenen Sprache; Entwürfe (von der KI oder ungeprüft) sieht nur die Administration beim Prüfen.

const PATTERNS = new Set(catalog.patterns);
const SOURCES = [...catalog.strings, ...catalog.patterns];
const KNOWN = new Set(SOURCES);

const slots = (text: string) => [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
const sameSlots = (a: string, b: string) => slots(a).join() === slots(b).join();

function requireAdmin(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("Übersetzungen verwaltet die Administration.", 403);
}

function targetLanguage(value: unknown) {
  if (typeof value !== "string" || !TARGET_LANGUAGES.includes(value as (typeof TARGET_LANGUAGES)[number]))
    throw new ApiError("Unbekannte Sprache.");
  return value as Exclude<Language, "de">;
}

export async function languageStates(sql: Sql): Promise<LanguageState[]> {
  const [counts, released] = await Promise.all([
    sql`
      SELECT locale, COUNT(*) FILTER (WHERE status = 'reviewed')::int AS reviewed,
        COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts
      FROM carecore_translations WHERE source = ANY(${SOURCES}) GROUP BY locale` as Promise<Row[]>,
    releasedLanguages(sql),
  ]);
  return TARGET_LANGUAGES.map((locale) => {
    const row = counts.find((entry) => entry.locale === locale);
    return {
      locale,
      released: released.includes(locale),
      total: SOURCES.length,
      reviewed: Number(row?.reviewed ?? 0),
      drafts: Number(row?.drafts ?? 0),
    };
  });
}

// Wörterbuch einer Sprache: geprüfte Übersetzungen; mit `drafts` (nur Administration) auch Entwürfe.
export async function dictionaryFor(sql: Sql, locale: Language, drafts: boolean): Promise<Dictionary> {
  const dictionary: Dictionary = { strings: {}, patterns: {} };
  if (locale === "de") return dictionary;
  const rows = (await sql`
    SELECT source, target FROM carecore_translations
    WHERE locale = ${locale} AND (status = 'reviewed' OR ${drafts})`) as Row[];
  for (const row of rows) {
    const source = String(row.source);
    if (!KNOWN.has(source)) continue;
    if (PATTERNS.has(source)) dictionary.patterns[source] = String(row.target);
    else dictionary.strings[source] = String(row.target);
  }
  return dictionary;
}

export async function listTranslations(
  ctx: ApiContext,
  options: { locale: unknown; filter: unknown; query: unknown; offset: unknown },
) {
  requireAdmin(ctx);
  const locale = targetLanguage(options.locale);
  const filter = ["missing", "draft", "reviewed"].includes(String(options.filter))
    ? (options.filter as TranslationStatus)
    : null;
  const query = typeof options.query === "string" ? options.query.trim().toLocaleLowerCase("de-CH") : "";
  const offset = Math.max(0, Number(options.offset) || 0);
  const rows = (await ctx.sql`
    SELECT t.source, t.target, t.status, t.origin, t.updated_at, u.display_name AS updated_by
    FROM carecore_translations t LEFT JOIN carecore_users u ON u.id = t.updated_by
    WHERE t.locale = ${locale}`) as Row[];
  const stored = new Map(rows.map((row) => [String(row.source), row]));
  const entries: TranslationEntry[] = SOURCES.map((source) => {
    const row = stored.get(source);
    return {
      source,
      pattern: PATTERNS.has(source),
      target: row ? String(row.target) : "",
      status: row ? (row.status as TranslationStatus) : "missing",
      origin: row ? (row.origin as "ai" | "manual") : null,
      updatedAt: row ? iso(row.updated_at) : null,
      updatedBy: row ? ((row.updated_by as string | null) ?? null) : null,
    };
  }).filter(
    (entry) =>
      (!filter || entry.status === filter) &&
      (!query ||
        entry.source.toLocaleLowerCase("de-CH").includes(query) ||
        entry.target.toLocaleLowerCase("de-CH").includes(query)),
  );
  return { entries: entries.slice(offset, offset + 50), matching: entries.length, offset };
}

export async function saveTranslation(ctx: ApiContext, body: Record<string, unknown>) {
  requireAdmin(ctx);
  const locale = targetLanguage(body.locale);
  const source = typeof body.source === "string" ? body.source : "";
  if (!KNOWN.has(source)) throw new ApiError("Dieser Text steht nicht im Katalog.", 404);
  const target = typeof body.target === "string" ? body.target.trim().slice(0, 4000) : "";
  if (!target) throw new ApiError("Bitte die Übersetzung eingeben.");
  if (!sameSlots(source, target))
    throw new ApiError(`Die Platzhalter müssen erhalten bleiben: ${slots(source).join(" ") || "keine"}.`);
  const reviewed = body.reviewed === true;
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_translations (locale, source, target, status, origin, updated_by, updated_at, reviewed_by, reviewed_at)
      VALUES (${locale}, ${source}, ${target}, ${reviewed ? "reviewed" : "draft"}, 'manual', ${ctx.actor.id}, NOW(),
        ${reviewed ? ctx.actor.id : null}, ${reviewed ? new Date().toISOString() : null})
      ON CONFLICT (locale, source) DO UPDATE SET target = EXCLUDED.target, status = EXCLUDED.status,
        origin = CASE WHEN carecore_translations.target = EXCLUDED.target THEN carecore_translations.origin ELSE 'manual' END,
        updated_by = EXCLUDED.updated_by, updated_at = NOW(), reviewed_by = EXCLUDED.reviewed_by,
        reviewed_at = EXCLUDED.reviewed_at`,
    auditStatement(ctx, "translation", ctx.actor.organizationId, reviewed ? "reviewed" : "saved", null, {
      locale,
      source,
      target,
    }),
  ]);
}

export async function setLanguageReleased(ctx: ApiContext, localeInput: unknown, released: boolean) {
  requireAdmin(ctx);
  const locale = targetLanguage(localeInput);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_languages (locale, released, updated_by, updated_at) VALUES (${locale}, ${released}, ${ctx.actor.id}, NOW())
      ON CONFLICT (locale) DO UPDATE SET released = EXCLUDED.released, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    auditStatement(ctx, "language", ctx.actor.organizationId, released ? "released" : "withdrawn", null, { locale }),
  ]);
}

const SYSTEM = `Du übersetzt Oberflächentexte von CareOS, einer Software für Pflegedokumentation in Alters- und Pflegeheimen in der Schweiz.
Übersetze fachlich korrekt und knapp, wie in einer Software üblich (Knöpfe kurz, Anrede wie im Ausgangstext).
Behalte Platzhalter wie {0}, {1} unverändert bei, ebenso Zeichen wie ·, „ “, Zahlen, Einheiten und Abkürzungen wie BtM, REA, FHIR, SSO.
Pflegefachbegriffe wählst du so, wie sie in Pflegeeinrichtungen der Zielsprache gebräuchlich sind.
Antworte nur mit einem JSON-Objekt: Schlüssel ist die Nummer des Textes, Wert die Übersetzung.`;

export type TranslationCall = (request: { system: string; user: string; schema: object }) => Promise<string>;

// Standard: Mistral mit JSON-Schema-Ausgabe. Tests setzen ein Test-Double.
let translationCall: TranslationCall = mistralJson;
export const setTranslationCall = (call: TranslationCall) => {
  translationCall = call;
};

// KI-Entwürfe für noch fehlende Texte (höchstens `limit`); sie bleiben ungeprüft, bis die Administration sie prüft.
export async function draftTranslations(ctx: ApiContext, localeInput: unknown, limit = 120) {
  requireAdmin(ctx);
  const locale = targetLanguage(localeInput);
  if (!mistralConfigured())
    throw new ApiError("Die KI für Übersetzungen ist nicht eingerichtet (MISTRAL_API_KEY fehlt).", 503);
  const rows = (await ctx.sql`SELECT source FROM carecore_translations WHERE locale = ${locale}`) as Row[];
  const done = new Set(rows.map((row) => String(row.source)));
  const batch = SOURCES.filter((source) => !done.has(source)).slice(0, Math.min(Math.max(limit, 1), 200));
  if (!batch.length) return { drafted: 0, remaining: 0 };
  const keys = batch.map((_, index) => String(index));
  let content = "";
  try {
    content = await translationCall({
      system: SYSTEM,
      user: `Zielsprache: ${LANGUAGES[locale].english} (${LANGUAGES[locale].label}).\nTexte (JSON, Nummer → Deutsch):\n${JSON.stringify(
        Object.fromEntries(batch.map((source, index) => [index, source])),
      )}`,
      schema: {
        type: "object",
        properties: Object.fromEntries(keys.map((key) => [key, { type: "string" }])),
        required: keys,
      },
    });
  } catch (error) {
    if (error instanceof MistralError) throw new ApiError(error.message, error.status);
    throw error;
  }
  const json = /\{[\s\S]*\}/.exec(content)?.[0];
  let parsed: Record<string, unknown> = {};
  try {
    parsed = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    throw new ApiError("Die KI hat keine lesbare Antwort geliefert. Bitte erneut versuchen.", 502);
  }
  const accepted = batch
    .map((source, index) => ({ source, target: typeof parsed[index] === "string" ? String(parsed[index]).trim() : "" }))
    .filter((entry) => entry.target && sameSlots(entry.source, entry.target));
  if (accepted.length)
    await ctx.sql.transaction([
      ...accepted.map(
        (entry) => ctx.sql`
          INSERT INTO carecore_translations (locale, source, target, status, origin, updated_by)
          VALUES (${locale}, ${entry.source}, ${entry.target.slice(0, 4000)}, 'draft', 'ai', ${ctx.actor.id})
          ON CONFLICT (locale, source) DO NOTHING`,
      ),
      auditStatement(ctx, "language", ctx.actor.organizationId, "ai_drafted", null, {
        locale,
        count: accepted.length,
        model: mistralModel(),
      }),
    ]);
  return { drafted: accepted.length, remaining: SOURCES.length - done.size - accepted.length };
}

// Ganze Seite prüfen: die angezeigten Entwürfe gelten als geprüft (nach dem Lesen durch die Administration).
export async function reviewTranslations(ctx: ApiContext, localeInput: unknown, sources: unknown) {
  requireAdmin(ctx);
  const locale = targetLanguage(localeInput);
  const list = Array.isArray(sources)
    ? sources.filter((source): source is string => KNOWN.has(source)).slice(0, 50)
    : [];
  if (!list.length) return 0;
  const updated = (await ctx.sql`
    UPDATE carecore_translations SET status = 'reviewed', reviewed_by = ${ctx.actor.id}, reviewed_at = NOW()
    WHERE locale = ${locale} AND source = ANY(${list}) AND status = 'draft' RETURNING source`) as Row[];
  if (updated.length)
    await auditStatement(ctx, "language", ctx.actor.organizationId, "reviewed_page", null, {
      locale,
      sources: updated.map((row) => row.source),
    });
  return updated.length;
}
