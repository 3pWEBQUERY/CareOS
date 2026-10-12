import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import {
  adoptKompassNeed,
  completeKompass,
  discardKompass,
  dueKompass,
  kompassDetail,
  kompassReport,
  kompassStatistics,
  kompassStatus,
  saveKompassDraft,
  startKompass,
} from "@/lib/kompass";
import { recordSummary } from "@/lib/resident-record";
import { dailyWorklist } from "@/lib/worklist";
import { KOMPASS_DOMAINS, KOMPASS_INSTRUMENT, NOT_APPLICABLE, SCALES } from "@/lib/kompass-instrument";
import { raiWorkplace } from "@/lib/rai";
import { draftKompassSummary, reviewDraft, setDraftCall } from "@/lib/ai";
import { mistralText } from "@/lib/mistral";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

const zurichDay = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(Date.now() + offset * 86_400_000));

// Alle Fragen beantworten und je Bereich über den Handlungsbedarf entscheiden (Mobilität mit Handlungsbedarf).
function fullPatch(level = 0) {
  const answers: Record<string, string> = {};
  const domains: Record<string, Record<string, unknown>> = {};
  for (const domain of KOMPASS_DOMAINS) {
    for (const item of domain.items) {
      const options = SCALES[item.scale].options;
      answers[`${domain.id}.${item.id}`] = options[Math.min(level, options.length - 1)].value;
    }
    domains[domain.id] = { need: false };
  }
  domains.mobility = { need: true, needText: "Begleitung beim Aufstehen am Morgen", resources: "Geht gerne spazieren" };
  return { answers, domains };
}

test("Kompass: beginnen, automatisch speichern, Abschluss nur vollständig, Fristen der Einrichtung, Protokoll", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const start = { occasion: "admission", assessedOn: zurichDay(0) };

  // Beginnen: Anlass, Datum nicht in der Zukunft, Verantwortliche nur mit Berechtigung (Pflege hat sie nicht).
  assert.match((await failure(startKompass(ctx, residentId, { ...start, occasion: "x" }))).message, /Anlass/);
  assert.match(
    (await failure(startKompass(ctx, residentId, { ...start, assessedOn: zurichDay(2) }))).message,
    /Zukunft/,
  );
  assert.match(
    (await failure(startKompass(ctx, residentId, { ...start, assessorId: f.people.max }))).message,
    /darf keine Abklärungen/,
  );
  const { id } = await startKompass(ctx, residentId, start);
  assert.equal((await failure(startKompass(ctx, residentId, start))).status, 409, "nur ein Entwurf je Person");
  let detail = await kompassDetail(ctx, residentId);
  assert.equal(detail.draft?.id, id);
  assert.equal(detail.draft?.instrument, KOMPASS_INSTRUMENT);
  assert.equal(detail.draft?.assessorId, f.people.anna, "ohne Wahl ist die Person selbst verantwortlich");
  assert.equal(detail.settings.intervalMonths, null);

  // Speichern ändert nur die geschickten Felder; ungültige Antworten werden abgewiesen.
  assert.match(
    (await failure(saveKompassDraft(ctx, residentId, { id, patch: { answers: { "mobility.transfer": "9" } } })))
      .message,
    /Aufstehen und Hinsetzen/,
  );
  assert.match(
    (
      await failure(
        saveKompassDraft(ctx, residentId, { id, patch: { answers: { "mobility.transfer": NOT_APPLICABLE } } }),
      )
    ).message,
    /ungültig/,
  );
  await saveKompassDraft(ctx, residentId, { id, patch: { answers: { "mobility.transfer": "2" } } });
  const saved = await saveKompassDraft(ctx, residentId, {
    id,
    patch: {
      answers: { "mobility.stairs": NOT_APPLICABLE },
      domains: { mobility: { wishes: "Morgens zuerst Kaffee" } },
    },
  });
  assert.ok(saved.progress > 0 && saved.progress < 100);
  detail = await kompassDetail(ctx, residentId);
  assert.equal(detail.draft?.kompass?.answers["mobility.transfer"], "2", "frühere Antwort bleibt");
  assert.equal(detail.draft?.kompass?.answers["mobility.stairs"], NOT_APPLICABLE);
  assert.equal(detail.draft?.kompass?.domains.mobility.wishes, "Morgens zuerst Kaffee");
  await saveKompassDraft(ctx, residentId, { id, patch: { answers: { "mobility.stairs": null } } });
  assert.equal((await kompassDetail(ctx, residentId)).draft?.kompass?.answers["mobility.stairs"], undefined);

  // Abschliessen erst vollständig; Handlungsbedarf „Ja“ verlangt eine Beschreibung.
  assert.match((await failure(completeKompass(ctx, residentId, { id }))).message, /Zum Abschliessen fehlt noch/);
  const patch = fullPatch();
  await saveKompassDraft(ctx, residentId, {
    id,
    patch: { ...patch, domains: { ...patch.domains, mobility: { need: true, needText: "" } } },
  });
  assert.match(
    (await failure(completeKompass(ctx, residentId, { id }))).message,
    /Bewegung & Mobilität: Handlungsbedarf festhalten/,
  );
  await saveKompassDraft(ctx, residentId, { id, patch });
  const done = await completeKompass(ctx, residentId, { id });
  assert.equal(done.dueOn, null, "ohne Frist der Einrichtung keine automatische Fälligkeit");
  assert.equal((await failure(saveKompassDraft(ctx, residentId, { id, patch }))).status, 409, "abgeschlossen");
  detail = await kompassDetail(ctx, residentId);
  assert.equal(detail.draft, null);
  assert.equal(detail.previous?.id, id);
  assert.equal(detail.previous?.completedBy, "Anna Müller");
  assert.equal(detail.previous?.kompass?.domains.mobility.needText, "Begleitung beim Aufstehen am Morgen");

  // Arbeitskorb: Handlungsbedarf je Person; Fristen nach den Einstellungen der Einrichtung.
  let row = (await raiWorkplace(ctx)).residents.find((item) => item.id === residentId)!;
  assert.equal(row.state, "current");
  assert.equal(row.needs, 1);
  assert.equal(row.dueOn, null);
  await q(
    `UPDATE carecore_organizations SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{app}',
       '{"kompassIntervalMonths": {"enabled": true, "value": 6}, "kompassAdmissionDays": {"enabled": true, "value": 14}}')
     WHERE id = $1`,
    [f.org],
  );
  const second = await startKompass(ctx, residentId, { occasion: "change", assessedOn: zurichDay(0) });
  await saveKompassDraft(ctx, residentId, { id: second.id, patch: fullPatch(1) });
  const next = await completeKompass(ctx, residentId, { id: second.id });
  const sixMonths = new Date(`${zurichDay(0)}T12:00:00Z`);
  sixMonths.setUTCMonth(sixMonths.getUTCMonth() + 6);
  assert.equal(next.dueOn, sixMonths.toISOString().slice(0, 10));
  detail = await kompassDetail(ctx, residentId);
  assert.deepEqual(
    detail.history.map((item) => item.id),
    [second.id, id],
    "die neuere zuerst, die frühere bleibt im Verlauf",
  );
  row = (await raiWorkplace(ctx)).residents.find((item) => item.id === residentId)!;
  assert.equal(row.dueOn, next.dueOn);
  assert.equal(row.reason, "Folgeabklärung (alle 6 Monate)");

  // Neue Person mit Eintrittsdatum: erste Abklärung nach der Frist der Einrichtung.
  const newcomer = await createResident(f, "Otto Neu");
  await q(`UPDATE carecore_residents SET admitted_on = $2 WHERE id = $1`, [newcomer, zurichDay(-20)]);
  const fresh = (await raiWorkplace(ctx)).residents.find((item) => item.id === newcomer)!;
  assert.equal(fresh.dueOn, zurichDay(-6));
  assert.equal(fresh.state, "overdue");
  assert.equal(fresh.reason, "Erste Abklärung nach Eintritt");

  // Verwerfen nur mit Grund; der Entwurf verschwindet aus Verlauf und Arbeitskorb.
  const third = await startKompass(ctx, newcomer, { occasion: "admission", assessedOn: zurichDay(0) });
  assert.match((await failure(discardKompass(ctx, newcomer, { id: third.id, reason: " " }))).message, /Grund/);
  await discardKompass(ctx, newcomer, { id: third.id, reason: "versehentlich begonnen" });
  assert.equal((await kompassDetail(ctx, newcomer)).draft, null);
  assert.equal((await kompassDetail(ctx, newcomer)).history.length, 0);

  const log = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'rai_assessment' AND after_data ->> 'residentId' = ANY($1)
     ORDER BY created_at, action`,
    [[residentId, newcomer]],
  );
  assert.deepEqual(
    log.map((item) => item.action),
    ["started", "completed", "started", "completed", "started", "discarded"],
  );

  // Andere Einrichtung: kein Zugriff.
  const other = await apiContextFor(await fixture(), "anna");
  assert.equal((await failure(kompassDetail(other, residentId))).status, 404);
  assert.equal((await failure(startKompass(other, residentId, start))).status, 404);
  assert.equal((await failure(saveKompassDraft(other, residentId, { id: randomUUID(), patch }))).status, 404);
});

test("Kompass: Hinweise aus der Akte je Bereich (nur Fakten, ohne Bewertung)", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  await q(
    `INSERT INTO carecore_resident_belongings (id, organization_id, resident_id, kind, name, marking)
     VALUES ($1, $2, $3, 'aid', 'Rollator', 'blau')`,
    [randomUUID(), f.org, residentId],
  );
  await q(
    `INSERT INTO carecore_resident_diagnoses (id, organization_id, resident_id, label, kind) VALUES ($1, $2, $3, 'Diabetes mellitus Typ 2', 'main')`,
    [randomUUID(), f.org, residentId],
  );
  await q(
    `INSERT INTO carecore_quality_events (id, organization_id, resident_id, type, occurred_at, description)
     VALUES ($1, $2, $3, 'Sturz', NOW() - INTERVAL '3 days', 'Im Badezimmer ausgerutscht')`,
    [randomUUID(), f.org, residentId],
  );
  const { context } = await kompassDetail(ctx, residentId);
  assert.deepEqual(context.aids, [{ label: "Rollator", detail: "blau", href: "/c/bewohner" }]);
  assert.deepEqual(
    context.diagnoses.map((fact) => [fact.label, fact.detail]),
    [["Diabetes mellitus Typ 2", "Hauptdiagnose"]],
  );
  assert.equal(context.falls.length, 1);
  assert.match(context.falls[0].label, /^Sturz am \d{2}\.\d{2}\.\d{4}$/);
  assert.equal(context.falls[0].detail, "Im Badezimmer ausgerutscht");
  assert.deepEqual(context.wounds, []);
});

test("Kompass: Bericht mit Vergleich, Handlungsbedarf als Ziel übernehmen, Akte und Tagesliste", async () => {
  const f = await fixture();
  const reader = await apiContextFor(f, "anna");
  const ctx = {
    ...reader,
    actor: { ...reader.actor, permissions: [...reader.actor.permissions, "documentation.write", "rai.manage"] },
  } as ApiContext;
  const without = {
    ...reader,
    actor: { ...reader.actor, permissions: reader.actor.permissions.filter((item) => item !== "documentation.write") },
  } as ApiContext;
  const residentId = await createResident(f);

  // Ohne Abklärung: nichts im Pflegeprozess, nichts in der Tagesliste.
  let status = await kompassStatus(ctx, residentId);
  assert.deepEqual(status, { lastOn: null, needs: [], dueOn: null, inProgress: null, canOpen: true });
  assert.equal((await kompassStatus(without, residentId)).canOpen, false);

  // Erste Abklärung (Mobilität mit Handlungsbedarf), dann eine zweite mit mehr Unterstützung.
  const first = await startKompass(ctx, residentId, { occasion: "admission", assessedOn: zurichDay(-30) });
  await saveKompassDraft(ctx, residentId, { id: first.id, patch: fullPatch(0) });
  await completeKompass(ctx, residentId, { id: first.id });
  const second = await startKompass(ctx, residentId, { occasion: "change", assessedOn: zurichDay(0) });
  status = await kompassStatus(ctx, residentId);
  assert.equal(status.inProgress, 0, "begonnene Abklärung");
  assert.deepEqual(
    (await dueKompass(ctx)).filter((row) => row.id === residentId).map((row) => row.state),
    ["in_progress"],
  );
  const worklist = await dailyWorklist(ctx, f.units.a);
  assert.deepEqual(
    worklist.residents
      .find((row) => row.id === residentId)
      ?.items.filter((item) => item.label.startsWith("Kompass"))
      .map((item) => [item.label, item.detail, item.href]),
    [["Kompass fortsetzen", "Abklärung zu 0% erledigt", `/c/kompass/abklaerung?resident=${residentId}`]],
  );
  assert.deepEqual(await dueKompass(reader), [], "ohne Berechtigung für den Kompass kein Eintrag");
  await saveKompassDraft(ctx, residentId, { id: second.id, patch: fullPatch(2) });
  await completeKompass(ctx, residentId, { id: second.id });

  // Bericht: Antworten, vorherige Abklärung zum Vergleich; die ältere ist nicht mehr übernehmbar.
  const report = await kompassReport(ctx, second.id);
  assert.equal(report.previous?.id, first.id);
  assert.equal(report.assessment.kompass?.answers["mobility.transfer"], "2");
  assert.equal(report.previous?.kompass?.answers["mobility.transfer"], "0");
  assert.equal(report.canAdopt, true);
  assert.equal((await kompassReport(ctx, first.id)).canAdopt, false);
  assert.equal((await kompassReport(without, second.id)).canAdopt, false);
  assert.equal((await failure(kompassReport(ctx, randomUUID()))).status, 404);
  status = await kompassStatus(ctx, residentId);
  assert.equal(status.lastOn, zurichDay(0));
  assert.deepEqual(status.needs, ["Bewegung & Mobilität"]);
  assert.deepEqual((await recordSummary(ctx, residentId)).kompass, status);

  // Übernahme: nur mit Handlungsbedarf und Recht, Ziel überprüfbar, ohne Plan wird einer angelegt.
  const adopt = {
    assessmentId: second.id,
    domainId: "mobility",
    statement: "Steht mit Begleitung sicher auf",
    targetDate: zurichDay(28),
  };
  assert.equal((await failure(adoptKompassNeed(without, residentId, adopt))).status, 403);
  assert.equal(
    (await failure(adoptKompassNeed(ctx, residentId, { ...adopt, domainId: "skin" }))).message,
    "In diesem Bereich ist kein Handlungsbedarf festgehalten.",
  );
  assert.equal(
    (await failure(adoptKompassNeed(ctx, residentId, { ...adopt, statement: " " }))).message,
    "Bitte das Ziel überprüfbar formulieren.",
  );
  assert.equal(
    (await failure(adoptKompassNeed(ctx, residentId, { ...adopt, targetDate: zurichDay(-1) }))).message,
    "Das Überprüfungsdatum liegt in der Vergangenheit.",
  );
  assert.equal(
    (await failure(adoptKompassNeed(ctx, residentId, { ...adopt, assessmentId: first.id }))).status,
    409,
    "nur aus der gültigen Abklärung",
  );
  const plansBefore = await q(`SELECT id FROM carecore_care_plans WHERE resident_id = $1`, [residentId]);
  assert.equal(plansBefore.length, 0, "Fehlversuche legen keinen Pflegeplan an");
  const adopted = await adoptKompassNeed(ctx, residentId, adopt);
  assert.equal(adopted.createdPlan, true);
  const [goal] = await q<{
    category: string;
    problem: string;
    resources: string;
    statement: string;
    care_plan_id: string;
  }>(`SELECT category, problem, resources, statement, care_plan_id FROM carecore_care_goals WHERE id = $1`, [
    adopted.goalId,
  ]);
  assert.deepEqual(goal, {
    category: "Mobilität",
    problem: "Begleitung beim Aufstehen am Morgen",
    resources: "Geht gerne spazieren",
    statement: "Steht mit Begleitung sicher auf",
    care_plan_id: adopted.planId,
  });
  assert.equal(
    (await failure(adoptKompassNeed(ctx, residentId, adopt))).message,
    "Dieser Handlungsbedarf ist bereits in die Pflegeplanung übernommen.",
  );
  assert.deepEqual((await kompassReport(ctx, second.id)).goals[adopted.goalId], {
    statement: "Steht mit Begleitung sicher auf",
    status: "active",
    targetDate: zurichDay(28),
  });
  const log = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'rai_assessment' AND entity_id = $1 ORDER BY created_at`,
    [second.id],
  );
  assert.deepEqual(
    log.map((row) => row.action),
    ["started", "completed", "need_adopted"],
  );
});

test("Kompass: Auswertung je Wohnbereich (nur gezählt) und KI-Entwurf für das Gesamtbild", async () => {
  const f = await fixture();
  const reader = await apiContextFor(f, "anna");
  const ctx = {
    ...reader,
    actor: { ...reader.actor, permissions: [...reader.actor.permissions, "rai.manage", "ai.use"] },
  } as ApiContext;
  const first = await createResident(f, "Erna Muster");
  const second = await createResident(f, "Hans Beispiel");
  await createResident(f, "Olga Ohne");
  for (const [residentId, level] of [
    [first, 1],
    [second, 2],
  ] as const) {
    const started = await startKompass(ctx, residentId, { occasion: "admission", assessedOn: zurichDay(0) });
    await saveKompassDraft(ctx, residentId, { id: started.id, patch: fullPatch(level) });
    await completeKompass(ctx, residentId, { id: started.id });
  }

  // Ganzes Haus: drei Personen, zwei mit abgeschlossener Abklärung; Mobilität bei beiden mit Handlungsbedarf.
  const house = await kompassStatistics(ctx, null);
  assert.equal(house.careUnit, null);
  assert.equal(house.people, 3);
  assert.equal(house.assessed, 2);
  const mobility = house.domains.find((domain) => domain.id === "mobility");
  assert.equal(mobility?.withNeed, 2);
  assert.equal(mobility?.withSupport, 2, "Antworten über der ersten Stufe der Skala");
  const transfer = mobility?.items.find((item) => item.key === "mobility.transfer");
  assert.deepEqual(
    transfer?.counts.map((count) => count.count),
    [0, 1, 1, 0, 0],
  );
  assert.equal(transfer?.answered, 2);
  assert.equal(house.domains.find((domain) => domain.id === "communication")?.withNeed, 0);
  // Massnahmen: „Macht es selbst“ zählt nicht als Unterstützung, „Mit Unterstützung“ schon.
  assert.equal(house.domains.find((domain) => domain.id === "treatment")?.withSupport, 1);

  // Wohnbereich: der andere Wohnbereich ist leer, fremde Wohnbereiche werden abgewiesen.
  const unitA = await kompassStatistics(ctx, f.units.a);
  assert.equal(unitA.careUnit?.name, "Wohngruppe A");
  assert.equal(unitA.assessed, 2);
  const unitB = await kompassStatistics(ctx, f.units.b);
  assert.equal(unitB.people, 0);
  assert.equal(unitB.assessed, 0);
  assert.equal((await failure(kompassStatistics(ctx, randomUUID()))).status, 404);
  assert.equal((await failure(kompassStatistics(ctx, "x"))).status, 400);

  // KI-Entwurf: nur mit laufender Abklärung, ohne Namen, Entscheide der Fachperson im Auftrag; die Abklärung selbst
  // bleibt unverändert.
  const previousKey = process.env.MISTRAL_API_KEY;
  process.env.MISTRAL_API_KEY = "test-double";
  try {
    const sent: string[] = [];
    setDraftCall(async ({ user }) => {
      sent.push(user);
      return { text: "Frau EM lebt sich gut ein.", truncated: false };
    });
    assert.equal((await failure(draftKompassSummary(ctx, first))).status, 404);
    const draft = await startKompass(ctx, first, { occasion: "change", assessedOn: zurichDay(0) });
    await saveKompassDraft(ctx, first, { id: draft.id, patch: fullPatch(2) });
    const result = await draftKompassSummary(ctx, first);
    assert.equal(result.task, "kompassSummary");
    assert.equal(result.content, "Frau EM lebt sich gut ein.");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].includes("Erna") || sent[0].includes("Muster"), false, "keine Namen an die KI");
    assert.match(sent[0], /EM \(/);
    assert.match(sent[0], /Handlungsbedarf \(Entscheid der Fachperson\): Ja – Begleitung beim Aufstehen am Morgen/);
    assert.match(sent[0], /Sehen: Deutlich eingeschränkt \(zuvor: Leicht eingeschränkt\)/);
    assert.match(sent[0], /bewerte den Bedarf nicht selbst/);
    const detail = await kompassDetail(ctx, first);
    assert.equal(detail.draft?.kompass?.summary, "", "das Gesamtbild übernimmt erst die Fachperson");
    assert.equal(detail.aiDraft, true);
    assert.equal((await kompassDetail(reader, first)).aiDraft, false, "ohne Berechtigung für die KI kein Entwurf");
    assert.equal((await reviewDraft(ctx, result.id, { action: "discard" })).status, "discarded");
    const [audit] = await q<{ after_data: { task: string; assessmentId: string } }>(
      `SELECT after_data FROM carecore_audit_log WHERE entity_type = 'ai_draft' AND entity_id = $1 AND action = 'created'`,
      [result.id],
    );
    assert.deepEqual([audit.after_data.task, audit.after_data.assessmentId], ["kompassSummary", draft.id]);
  } finally {
    setDraftCall(mistralText);
    if (previousKey === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = previousKey;
  }
});
