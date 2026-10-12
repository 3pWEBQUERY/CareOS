import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { aiSearch, setSearchCall } from "@/lib/ai-search";
import { apiContextFor, createResident, fixture, q } from "../support/db";

test("Such-Assistenz: Daten pseudonymisiert an die KI, Kennungen zurück auf die Akten, nur Wohnbereich", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  await q(
    `INSERT INTO carecore_quality_events (id, organization_id, resident_id, care_unit_id, type, severity, occurred_at, description)
     VALUES ($1, $2, $3, $4, 'Sturz', 'attention', NOW() - INTERVAL '1 day', 'Neben dem Bett gestürzt, keine Verletzung')`,
    [randomUUID(), f.org, erna, f.units.a],
  );
  let prompt = "";
  setSearchCall(async (request) => {
    prompt = request.user;
    const token = /\[(R\d+)\] EM/.exec(request.user)?.[1];
    return JSON.stringify({ answer: `[${token}] ist gestern gestürzt.`, residents: [token, "R99"] });
  });
  const previous = process.env.MISTRAL_API_KEY;
  process.env.MISTRAL_API_KEY = "test-ohne-aufruf";
  try {
    const result = await aiSearch(ctx, { question: "Wer ist diese Woche gestürzt?", careUnitId: f.units.a });
    // Namen gehen nicht an die KI, nur Kennung und Kürzel.
    assert.ok(!prompt.includes("Erna") && !prompt.includes("Muster"));
    assert.match(prompt, /Sturz \(attention, open\): Neben dem Bett gestürzt/);
    assert.equal(result.answer, "Erna Muster ist gestern gestürzt.");
    assert.deepEqual(
      result.residents.map((r) => r.id),
      [erna],
      "unbekannte Kennung R99 wird verworfen",
    );
    assert.ok(!result.residents.some((r) => r.id === otto));
    // Anderer Wohnbereich: niemand.
    const empty = await aiSearch(ctx, { question: "Wer ist diese Woche gestürzt?", careUnitId: f.units.b });
    assert.equal(empty.residents.length, 0);
    const [audit] = await q<{ after_data: { questionLength: number } }>(
      `SELECT after_data FROM carecore_audit_log WHERE entity_type = 'ai_search' AND actor_user_id = $1 LIMIT 1`,
      [f.people.anna],
    );
    assert.equal(audit.after_data.questionLength, "Wer ist diese Woche gestürzt?".length);
  } finally {
    if (previous === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previous;
  }
});
