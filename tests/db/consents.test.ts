import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import {
  consentList,
  consentOverview,
  readConsentTopics,
  recordConsent,
  revokeConsent,
  saveConsentTopics,
} from "@/lib/consents";
import { apiContextFor, createResident, fixture, q } from "../support/db";

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  assert.fail("Fehler erwartet");
}

test("Einwilligungen: Themen der Einrichtung, Entscheid, neuer Entscheid gilt, Widerruf, Übersicht", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  } as ApiContext;
  const reader = {
    ...nurse,
    actor: { ...nurse.actor, permissions: nurse.actor.permissions.filter((p) => p !== "residents.write") },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");

  // Keine Vorgabe: ohne Themen der Einrichtung bleibt die Liste leer.
  assert.deepEqual(await readConsentTopics(admin), []);
  assert.deepEqual((await consentList(nurse, erna)).topics, []);
  assert.equal((await failure(saveConsentTopics(nurse, { topics: ["Fotos"] }))).status, 403);
  assert.equal(
    (await failure(saveConsentTopics(admin, { topics: ["Fotos", "fotos"] }))).message,
    "Jedes Thema darf nur einmal vorkommen.",
  );
  await saveConsentTopics(admin, { topics: ["Fotos", " Weitergabe an Angehörige ", ""] });

  assert.equal(
    (
      await failure(
        recordConsent(reader, erna, { topic: "Fotos", decision: "granted", decidedBy: "x", decidedOn: "2026-01-01" }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await failure(
        recordConsent(nurse, erna, { topic: "Fotos", decision: "vielleicht", decidedBy: "x", decidedOn: "2026-01-01" }),
      )
    ).message,
    "Bitte „zugestimmt“ oder „abgelehnt“ wählen.",
  );
  assert.equal(
    (
      await failure(
        recordConsent(nurse, erna, { topic: "Fotos", decision: "granted", decidedBy: "", decidedOn: "2026-01-01" }),
      )
    ).message,
    "Bitte angeben, wer entschieden hat (Person selbst oder Vertretung).",
  );
  assert.equal(
    (
      await failure(
        recordConsent(nurse, erna, { topic: "Fotos", decision: "granted", decidedBy: "x", decidedOn: "2999-01-01" }),
      )
    ).message,
    "Das Datum liegt in der Zukunft.",
  );

  await recordConsent(nurse, erna, {
    topic: "Fotos",
    decision: "granted",
    decidedBy: "Erna Muster",
    decidedOn: "2026-01-10",
  });
  let list = await recordConsent(nurse, erna, {
    topic: "fotos",
    decision: "refused",
    decidedBy: "Tochter (Vorsorgebeauftragte)",
    decidedOn: "2026-03-01",
    note: "keine Fotos im Internet",
  });
  assert.deepEqual(
    list.topics.map((item) => [item.topic, item.status]),
    [
      ["Fotos", "refused"],
      ["Weitergabe an Angehörige", "missing"],
    ],
    "der jüngste Entscheid gilt",
  );
  assert.equal(list.history.length, 2);

  list = await recordConsent(nurse, erna, {
    topic: "Weitergabe an Angehörige",
    decision: "granted",
    decidedBy: "Erna Muster",
    decidedOn: "2026-02-01",
  });
  const sharing = list.topics[1].current!;
  assert.equal(
    (await failure(revokeConsent(nurse, sharing.id, { revokedOn: "2026-01-01" }))).message,
    "Der Widerruf liegt vor dem Entscheid.",
  );
  list = await revokeConsent(nurse, sharing.id, { revokedOn: "2026-04-01", note: "telefonisch" });
  assert.equal(list.topics[1].status, "revoked");
  assert.equal((await failure(revokeConsent(nurse, sharing.id, { revokedOn: "2026-04-02" }))).status, 409);

  await recordConsent(nurse, otto, {
    topic: "Fotos",
    decision: "granted",
    decidedBy: "Otto Beispiel",
    decidedOn: "2026-02-02",
  });
  const overview = await consentOverview(nurse, "Fotos");
  const status = (id: string) => overview.units.flatMap((unit) => unit.residents).find((r) => r.id === id);
  assert.equal(overview.topic, "Fotos");
  assert.deepEqual([status(erna)?.status, status(erna)?.since], ["refused", "2026-03-01"]);
  assert.deepEqual([status(otto)?.status, status(otto)?.since], ["granted", "2026-02-02"]);

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'resident_consent' AND after_data ->> 'residentId' = $1
     ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["recorded", "recorded", "recorded", "revoked"],
  );
  const other = await fixture();
  const stranger = await apiContextFor(other, "anna");
  assert.equal((await failure(consentList(stranger, erna))).status, 404);
  assert.equal((await failure(revokeConsent(stranger, sharing.id, { revokedOn: "2026-04-02" }))).status, 404);
});
