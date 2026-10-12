import { test } from "node:test";
import assert from "node:assert/strict";
import type { ApiContext } from "@/lib/api-context";
import catalog from "@/locales/catalog.json" with { type: "json" };
import { releasedLanguages } from "@/lib/languages";
import {
  dictionaryFor,
  draftTranslations,
  languageStates,
  listTranslations,
  reviewTranslations,
  saveTranslation,
  setLanguageReleased,
  setTranslationCall,
} from "@/lib/translations";
import { savePreferences } from "@/lib/user-settings";
import { apiContextFor, fixture, q } from "../support/db";

const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: Error) => error.message,
  );

async function admin(): Promise<ApiContext> {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  return { ...lead, actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] } };
}

test("Übersetzungen: nur Katalogtexte, Platzhalter bleiben, Entwürfe nur zum Prüfen, Freigabe der Sprache", async () => {
  const ctx = await admin();
  await q(`DELETE FROM carecore_translations WHERE locale = 'hu'`);
  await q(`DELETE FROM carecore_languages WHERE locale = 'hu'`);
  const text = catalog.strings.find((source) => source === "Speichern")!;
  const pattern = catalog.patterns.find((source) => /\{0\}/.test(source) && /\{1\}/.test(source))!;
  assert.ok(text && pattern, "Katalog enthält Texte und Muster");

  assert.equal(
    await rejected(saveTranslation(ctx, { locale: "hu", source: "Gibt es nicht im Katalog", target: "x" })),
    "Dieser Text steht nicht im Katalog.",
  );
  assert.equal(
    await rejected(saveTranslation(ctx, { locale: "de", source: text, target: "x" })),
    "Unbekannte Sprache.",
  );
  assert.match(
    await rejected(saveTranslation(ctx, { locale: "hu", source: pattern, target: "csak {0}" })),
    /Platzhalter müssen erhalten bleiben/,
  );
  await saveTranslation(ctx, { locale: "hu", source: text, target: "Mentés" });
  await saveTranslation(ctx, { locale: "hu", source: pattern, target: "{1} … {0}", reviewed: true });

  // Mitarbeitende: nur Geprüftes; die Administration beim Prüfen auch Entwürfe.
  assert.deepEqual(await dictionaryFor(ctx.sql, "hu", false), { strings: {}, patterns: { [pattern]: "{1} … {0}" } });
  assert.equal((await dictionaryFor(ctx.sql, "hu", true)).strings[text], "Mentés");
  const state = (await languageStates(ctx.sql)).find((entry) => entry.locale === "hu")!;
  assert.deepEqual([state.reviewed, state.drafts, state.released], [1, 1, false]);

  const drafts = await listTranslations(ctx, { locale: "hu", filter: "draft", query: "", offset: 0 });
  assert.deepEqual(
    drafts.entries.map((entry) => entry.source),
    [text],
  );
  assert.equal(await reviewTranslations(ctx, "hu", [text, "nicht im Katalog"]), 1);
  assert.equal((await dictionaryFor(ctx.sql, "hu", false)).strings[text], "Mentés");

  // Freigabe: erst dann wählbar für Mitarbeitende.
  const staff = await apiContextFor(await fixture(), "anna");
  assert.equal((await releasedLanguages(ctx.sql)).includes("hu"), false);
  assert.equal(await rejected(savePreferences(staff.actor, { language: "hu" })), "Sprache: Wert ist ungültig.");
  await setLanguageReleased(ctx, "hu", true);
  assert.ok((await releasedLanguages(ctx.sql)).includes("hu"));
  assert.equal((await savePreferences(staff.actor, { language: "hu" })).language, "hu");
  await setLanguageReleased(ctx, "hu", false);

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type IN ('translation', 'language') AND actor_user_id = $1 ORDER BY created_at`,
    [ctx.actor.id],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["saved", "reviewed", "reviewed_page", "released", "withdrawn"],
  );
});

test("KI-Entwürfe mit Mistral: nur als Entwurf, Platzhalter geprüft, ohne Schlüssel deaktiviert", async () => {
  const ctx = await admin();
  await q(`DELETE FROM carecore_translations WHERE locale = 'sq'`);
  const previous = process.env.MISTRAL_API_KEY;
  const previousModel = process.env.MISTRAL_MODEL;
  delete process.env.MISTRAL_MODEL;
  try {
    delete process.env.MISTRAL_API_KEY;
    assert.match(await rejected(draftTranslations(ctx, "sq", 5)), /MISTRAL_API_KEY fehlt/);

    process.env.MISTRAL_API_KEY = "test-double";
    const requests: Array<{ user: string; schema: { required?: string[] } }> = [];
    setTranslationCall(async (request) => {
      requests.push(request as (typeof requests)[number]);
      const texts = JSON.parse(request.user.slice(request.user.indexOf("{"))) as Record<string, string>;
      // Der erste Text verliert absichtlich seine Platzhalter, falls er welche hat; alle anderen werden markiert.
      return JSON.stringify(
        Object.fromEntries(Object.entries(texts).map(([key, text]) => [key, key === "0" ? "ohne" : `sq:${text}`])),
      );
    });
    const first = await draftTranslations(ctx, "sq", 5);
    assert.equal(requests.length, 1);
    assert.match(requests[0].user, /Zielsprache: Albanian/);
    assert.deepEqual(requests[0].schema.required, ["0", "1", "2", "3", "4"]);
    const firstSource = Object.values(
      JSON.parse(requests[0].user.slice(requests[0].user.indexOf("{"))) as Record<string, string>,
    )[0];
    const expected = /\{\d+\}/.test(firstSource) ? 4 : 5;
    assert.equal(first.drafted, expected);

    const stored = await q<{ status: string; origin: string; target: string }>(
      `SELECT status, origin, target FROM carecore_translations WHERE locale = 'sq'`,
    );
    assert.equal(stored.length, expected);
    assert.ok(stored.every((row) => row.status === "draft" && row.origin === "ai"));
    // Mitarbeitende sehen KI-Entwürfe nicht, bevor die Administration sie prüft.
    const visible = await dictionaryFor(ctx.sql, "sq", false);
    assert.equal(Object.keys(visible.strings).length + Object.keys(visible.patterns).length, 0);

    const [audit] = await q<{ after_data: { model: string; count: number } }>(
      `SELECT after_data FROM carecore_audit_log WHERE entity_type = 'language' AND action = 'ai_drafted'
       ORDER BY created_at DESC LIMIT 1`,
    );
    assert.deepEqual([audit.after_data.model, audit.after_data.count], ["mistral-small-latest", expected]);

    setTranslationCall(async () => "{ kaputt }");
    assert.match(await rejected(draftTranslations(ctx, "sq", 3)), /keine lesbare Antwort/);
  } finally {
    if (previous === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previous;
    if (previousModel !== undefined) process.env.MISTRAL_MODEL = previousModel;
    await q(`DELETE FROM carecore_translations WHERE locale = 'sq'`);
  }
});
