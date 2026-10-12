import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { generateDraft, rephraseText, reviewDraft, setDraftCall } from "@/lib/ai";
import { mistralText } from "@/lib/mistral";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

// Diktat umformulieren: Namen gehen nur als Platzhalter an die KI und stehen im Vorschlag wieder richtig.
test("Diktat mit KI umformulieren: pseudonymisiert, nur Vorschlag, Platzhalter zurückgesetzt", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const resident = await createResident(f, "Erna Muster");
  const previous = process.env.MISTRAL_API_KEY;
  try {
    delete process.env.MISTRAL_API_KEY;
    const missing = await failure(rephraseText(ctx, { text: "frau muster hat gut gegessen" }));
    assert.ok(missing instanceof ApiError);
    assert.equal(missing.status, 503);

    process.env.MISTRAL_API_KEY = "test-double";
    const sent: string[] = [];
    setDraftCall(async ({ user }) => {
      sent.push(user);
      const placeholder = user.match(/\[Person \d+\]/)?.[0] ?? "";
      return { text: `${placeholder} hat das Frühstück vollständig eingenommen.`, truncated: false };
    });
    const short = await failure(rephraseText(ctx, { text: "kurz" }));
    assert.ok(short instanceof ApiError);
    assert.equal(sent.length, 0, "zu kurzer Text geht nicht an die KI");

    const draft = await rephraseText(ctx, {
      text: "frau muster hat ähm alles gegessen beim frühstück",
      residentId: resident,
    });
    assert.equal(sent.length, 1);
    assert.equal(/muster/i.test(sent[0]), false, "keine Namen an die KI");
    assert.match(sent[0], /frau \[Person 1\] hat ähm alles gegessen/);
    assert.equal(draft.content, "muster hat das Frühstück vollständig eingenommen.");
    assert.equal(draft.task, "rephrase");
    assert.equal(draft.residentId, resident);
    assert.equal(draft.status, "draft");

    // Übernehmen vermerkt nur den Entwurf; ein Eintrag entsteht erst mit dem Speichern im Formular.
    const before = await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM carecore_documentation_entries WHERE resident_id = $1`,
      [resident],
    );
    assert.equal((await reviewDraft(ctx, draft.id, { action: "accept" })).status, "accepted");
    const after = await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM carecore_documentation_entries WHERE resident_id = $1`,
      [resident],
    );
    assert.equal(after[0].n, before[0].n);

    // Der allgemeine Assistent kann diese Aufgabe nicht direkt aufrufen.
    const general = await generateDraft(ctx, { task: "rephrase", prompt: "Wie geht es?", residentId: resident });
    assert.equal(general.task, "question");
  } finally {
    setDraftCall(mistralText);
    if (previous === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previous;
  }
});
