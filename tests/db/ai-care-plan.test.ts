import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { generateDraft, residentContext, setDraftCall } from "@/lib/ai";
import { termsFor } from "@/lib/terminology";
import { apiContextFor, createResident, fixture, q } from "../support/db";

// KI-Planungsassistenz: Datengrundlage (ohne Namen) und nur für eine Person.
test("Pflegeplanung: Einschätzungen, Probleme, Massnahmen und zwei Wochen Berichte – pseudonymisiert", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const resident = await createResident(f, "Erna Muster");
  const plan = randomUUID();
  const goal = randomUUID();
  const assessment = randomUUID();
  await q(`INSERT INTO carecore_care_plans (id, resident_id) VALUES ($1, $2)`, [plan, resident]);
  await q(
    `INSERT INTO carecore_care_goals (id, care_plan_id, category, statement, problem, resources)
     VALUES ($1, $2, 'Mobilität', 'Geht mit Rollator zum Speisesaal', 'Gangunsicherheit', 'Motiviert, nutzt Rollator')`,
    [goal, plan],
  );
  await q(
    `INSERT INTO carecore_interventions (id, care_goal_id, title, frequency) VALUES ($1, $2, 'Gehtraining im Flur', 'täglich')`,
    [randomUUID(), goal],
  );
  await q(`INSERT INTO carecore_assessments (id, organization_id, code, name) VALUES ($1, $2, $3, 'Sturzrisiko')`, [
    assessment,
    f.org,
    `sturz-${assessment.slice(0, 6)}`,
  ]);
  await q(
    `INSERT INTO carecore_assessment_records (id, assessment_id, resident_id, status, completed_at, score, risk_level, summary)
     VALUES ($1, $2, $3, 'completed', NOW() - INTERVAL '3 days', 12, 'erhöht', 'Zwei Stürze im letzten Quartal')`,
    [randomUUID(), assessment, resident],
  );
  await q(
    `INSERT INTO carecore_documentation_entries (id, resident_id, category, body, occurred_at)
     VALUES ($1, $2, 'Pflege', 'Unsicher beim Aufstehen, braucht Hilfe', NOW() - INTERVAL '10 days')`,
    [randomUUID(), resident],
  );

  const terms = termsFor(undefined);
  const planning = await residentContext(ctx, [resident], terms, true);
  assert.match(planning, /EM \(/, "nur Kürzel");
  assert.equal(planning.includes("Erna") || planning.includes("Muster"), false, "kein Name");
  assert.match(planning, /Problem: Gangunsicherheit/);
  assert.match(planning, /Ressourcen: Motiviert, nutzt Rollator/);
  assert.match(planning, /Massnahme \(Mobilität\): Gehtraining im Flur, täglich/);
  assert.match(planning, /Einschätzung .*Sturzrisiko, Punkte 12, erhöht – Zwei Stürze/);
  assert.match(planning, /Unsicher beim Aufstehen/, "Bericht von vor 10 Tagen gehört zur Planung");

  // Übliche Aufträge bleiben bei 48 Stunden und ohne Planungsdetails.
  const usual = await residentContext(ctx, [resident], terms);
  assert.equal(usual.includes("Unsicher beim Aufstehen"), false);
  assert.equal(usual.includes("Gehtraining"), false);
  assert.equal(usual.includes("Sturzrisiko"), false);
});

test("Pflegeplanung: ohne gewählte Person abgelehnt, bevor etwas an die KI geht", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const previous = process.env.MISTRAL_API_KEY;
  process.env.MISTRAL_API_KEY = "test-ohne-aufruf";
  try {
    const error = await generateDraft(ctx, { task: "carePlan", careUnitId: f.units.a }).catch((cause) => cause);
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 400);
    const drafts = await q(`SELECT 1 FROM carecore_ai_drafts WHERE organization_id = $1`, [f.org]);
    assert.equal(drafts.length, 0);
  } finally {
    if (previous === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previous;
  }
});

test("CareOS KI mit Mistral: Entwurf pseudonymisiert, gekürzte Antwort markiert, Fehler verständlich", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const resident = await createResident(f, "Erna Muster");
  const previous = process.env.MISTRAL_API_KEY;
  const previousModel = process.env.MISTRAL_MODEL;
  delete process.env.MISTRAL_MODEL;
  try {
    delete process.env.MISTRAL_API_KEY;
    const missing = await generateDraft(ctx, { task: "question", prompt: "Wie geht es?", residentId: resident }).catch(
      (cause) => cause,
    );
    assert.ok(missing instanceof ApiError);
    assert.equal(missing.status, 503);
    assert.match(missing.message, /MISTRAL_API_KEY fehlt/);

    process.env.MISTRAL_API_KEY = "test-double";
    const sent: string[] = [];
    setDraftCall(async ({ user }) => {
      sent.push(user);
      return { text: "Entwurf der KI", truncated: true };
    });
    const draft = await generateDraft(ctx, { task: "question", prompt: "Wie geht es?", residentId: resident });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].includes("Erna Muster"), false, "keine Namen an die KI");
    assert.match(sent[0], /Hinweise der Pflegefachperson: Wie geht es\?/);
    assert.equal(draft.content, "Entwurf der KI\n\n[Antwort gekürzt]");
    const [row] = await q<{ model: string }>(`SELECT model FROM carecore_ai_drafts WHERE id = $1`, [draft.id]);
    assert.equal(row.model, "mistral-small-latest");

    setDraftCall(async () => ({ text: "", truncated: false }));
    const empty = await generateDraft(ctx, { task: "question", prompt: "Noch einmal?", residentId: resident }).catch(
      (cause) => cause,
    );
    assert.ok(empty instanceof ApiError);
    assert.equal(empty.status, 502);
  } finally {
    if (previous === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previous;
    if (previousModel !== undefined) process.env.MISTRAL_MODEL = previousModel;
  }
});
