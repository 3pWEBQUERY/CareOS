import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ApiContext } from "@/lib/api-context";
import { portalResidentDetail, portalResidents, type PortalActor } from "@/lib/portal";
import { createPortalAccount, createPortalGrant, updatePortalGrant } from "@/lib/portal-admin";
import { portalAnswerVisit } from "@/lib/portal-visits";
import { visitOverview } from "@/lib/visits";
import { listEntries } from "@/lib/documentation";
import { apiContextFor, createResident, fixture, q, type Fixture } from "../support/db";

const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: Error) => error.message,
  );

async function admin(f: Fixture): Promise<ApiContext> {
  const lead = await apiContextFor(f, "leadA");
  return { ...lead, actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] } };
}

async function account(ctx: ApiContext, kind: "physician" | "relative", displayName: string): Promise<PortalActor> {
  const { id } = await createPortalAccount(ctx, {
    kind,
    displayName,
    username: `${kind}-${randomUUID().slice(0, 8)}`,
  });
  return {
    id,
    organizationId: ctx.actor.organizationId,
    kind,
    displayName,
    mustChangePassword: false,
    userAgent: "test",
  };
}

async function question(f: Fixture, resident: string, body: string, amendedFrom: string | null = null) {
  const id = randomUUID();
  await q(
    `INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body,
       importance, amended_from_id)
     VALUES ($1, $2, $3, $4, 'Beobachtung', 'Beobachtung', $5, 'visit', $6)`,
    [id, resident, f.units.a, f.people.anna, body, amendedFrom],
  );
  return id;
}

test("Visite im Portal: offene Fragen sehen, Rückmeldung als Arztvisite mit Protokoll und Hinweis", async () => {
  const f = await fixture();
  const ctx = await admin(f);
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const doctor = await account(ctx, "physician", "Dr. Meier");
  const relative = await account(ctx, "relative", "Petra Muster");

  // Die Visite gibt es nur für Ärztinnen und Ärzte.
  assert.equal(
    await rejected(createPortalGrant(ctx, relative.id, { residentId: erna, areas: ["visit"], basis: "consent" })),
    "Die Visite kann nur einem Zugang für Ärztin / Arzt freigegeben werden.",
  );
  const relativeGrant = await createPortalGrant(ctx, relative.id, {
    residentId: erna,
    areas: ["reports"],
    basis: "consent",
  });
  assert.equal(
    await rejected(
      updatePortalGrant(ctx, relativeGrant, { residentId: erna, areas: ["reports", "visit"], basis: "consent" }),
    ),
    "Die Visite kann nur einem Zugang für Ärztin / Arzt freigegeben werden.",
  );
  // Auch eine früher erteilte Freigabe wirkt bei Angehörigen nicht.
  await q(`UPDATE carecore_portal_grants SET areas = '["reports","visit"]'::jsonb WHERE id = $1`, [relativeGrant]);
  assert.deepEqual(
    (await portalResidents(ctx.sql, relative)).map((entry) => entry.areas),
    [["reports"]],
  );
  assert.equal((await portalResidentDetail(ctx.sql, relative, erna)).visit, undefined);

  await createPortalGrant(ctx, doctor.id, { residentId: erna, areas: ["visit"], basis: "treatment" });
  const open = await question(f, erna, "Schmerzmittel reicht nachts nicht");
  const original = await question(f, erna, "Bitte Blutdruck anschauen");
  const corrected = await question(f, erna, "Bitte Blutdruck und Ödeme anschauen", original);
  const foreign = await question(f, otto, "Hautstelle am Rücken");

  let detail = await portalResidentDetail(ctx.sql, doctor, erna);
  assert.deepEqual(
    detail.visit?.open.map((item) => [item.id, item.body, item.author]),
    [
      [open, "Schmerzmittel reicht nachts nicht", "Anna Müller"],
      [corrected, "Bitte Blutdruck und Ödeme anschauen", "Anna Müller"],
    ],
  );

  // Ohne Freigabe für die Person, für überholte Fassungen und ohne Text: nichts.
  assert.equal(
    await rejected(portalAnswerVisit(ctx.sql, doctor, foreign, { response: "Salbe" })),
    "Frage nicht gefunden.",
  );
  assert.equal(
    await rejected(portalAnswerVisit(ctx.sql, relative, open, { response: "Salbe" })),
    "Frage nicht gefunden.",
  );
  assert.equal(
    await rejected(portalAnswerVisit(ctx.sql, doctor, original, { response: "Okay" })),
    "Die Pflege hat die Frage inzwischen korrigiert. Bitte neu laden.",
  );
  assert.equal(
    await rejected(portalAnswerVisit(ctx.sql, doctor, open, { response: " a " })),
    "Bitte die Rückmeldung zur Frage festhalten.",
  );

  const { responseEntryId } = await portalAnswerVisit(ctx.sql, doctor, open, {
    response: "Reserve ab 22 Uhr erweitert, Verordnung folgt",
  });
  assert.equal(
    await rejected(portalAnswerVisit(ctx.sql, doctor, open, { response: "Nochmals" })),
    "Zu dieser Frage ist bereits eine Rückmeldung erfasst.",
  );

  detail = await portalResidentDetail(ctx.sql, doctor, erna);
  assert.deepEqual(
    detail.visit?.open.map((item) => item.id),
    [corrected],
  );
  assert.deepEqual(
    detail.visit?.answered.map((item) => [item.question, item.response, item.physician]),
    [["Schmerzmittel reicht nachts nicht", "Reserve ab 22 Uhr erweitert, Verordnung folgt", "Dr. Meier"]],
  );

  // In der Pflege: Eintrag „Arztvisite“ mit dem Portal-Zugang als Verfasser, Frage erledigt.
  const [entry] = await q<{ category: string; author_user_id: string | null; portal: string }>(
    `SELECT category, author_user_id, metadata ->> 'portalAccountId' AS portal FROM carecore_documentation_entries WHERE id = $1`,
    [responseEntryId],
  );
  assert.deepEqual(entry, { category: "Arztvisite", author_user_id: null, portal: doctor.id });
  const reader = await apiContextFor(f, "anna");
  const listed = await listEntries(reader, new URLSearchParams({ days: "1" }));
  assert.equal(listed.find((item) => item.id === responseEntryId)?.author, "Dr. Meier (Portal)");
  const overview = await visitOverview(reader, null);
  assert.equal(overview.open, 2);
  assert.deepEqual(
    overview.resolved.map((item) => [item.question, item.physician, item.resolvedBy]),
    [["Schmerzmittel reicht nachts nicht", "Dr. Meier", "Dr. Meier (Portal)"]],
  );

  const audit = await q<{ actor_user_id: string | null; actor: string }>(
    `SELECT actor_user_id, after_data ->> 'portalActor' AS actor FROM carecore_audit_log
     WHERE entity_id = $1 AND action = 'visit_answered'`,
    [open],
  );
  assert.deepEqual(audit, [{ actor_user_id: null, actor: "Dr. Meier (Portal)" }]);
  const log = await q<{ action: string }>(
    `SELECT action FROM carecore_portal_access_log WHERE account_id = $1 AND action = 'visit_answered'`,
    [doctor.id],
  );
  assert.equal(log.length, 1);
  const notified = await q<{ user_id: string }>(
    `SELECT user_id FROM carecore_notifications WHERE type = 'visit_answered' AND entity_id = $1`,
    [responseEntryId],
  );
  const users = notified.map((row) => row.user_id);
  assert.ok(users.includes(f.people.anna), "Pflege des Wohnbereichs erhält den Hinweis");
  assert.ok(!users.includes(f.people.ben), "andere Wohnbereiche nicht");
});
