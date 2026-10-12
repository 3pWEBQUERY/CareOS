import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_AREAS, auditActionKnown, auditChanges, auditSettingTitle, auditTitle } from "../lib/audit-labels.ts";
import { termsFor } from "../lib/terminology.ts";
import { describeAudit } from "../lib/resident-audit-labels.ts";

const terms = termsFor("resident");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Alle Paare (Bereich, Aktion), die der Code wörtlich ins Änderungsprotokoll schreibt.
function loggedPairs() {
  const pairs = new Set<string>();
  for (const file of [...sources("lib"), ...sources("app")]) {
    if (file.startsWith(join("lib", "roster"))) continue; // eigenes Protokoll des Dienstplans
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/auditStatement\(\s*[\w.]+,\s*(?:who,\s*)?"([a-z_]+)",[^,]+,\s*"([a-zA-Z_]+)"/g))
      pairs.add(`${match[1]}:${match[2]}`);
    for (const match of text.matchAll(
      /INSERT INTO carecore_audit_log[\s\S]{0,600}?'([a-z_]+)', (?:\$\{[^}]+\}|[a-z]+\.id), '([a-z_]+)'/g,
    ))
      pairs.add(`${match[1]}:${match[2]}`);
    for (const match of text.matchAll(/entityType: "([a-z_]+)",[^}]{0,200}?action: "([a-z_]+)"/g))
      pairs.add(`${match[1]}:${match[2]}`);
  }
  return pairs;
}

// Aktionen, die der Code aus Variablen zusammensetzt (siehe die jeweiligen Dateien).
const COMPUTED = [
  "site:create",
  "site:update",
  "care_unit:create",
  "care_unit:update",
  "portal_account:activated",
  "portal_account:updated",
  "quality_event:updated",
  ...["open", "investigating", "resolved", "closed"].map((status) => `quality_event:status_${status}`),
  ...["open", "planned", "done", "cancelled"].map((status) => `quality_action:status_${status}`),
  ...["discharged", "returned", "transferred", "deceased", "hospital", "absent"].map((kind) => `resident:stay_${kind}`),
  "task:completed",
  "task:partial",
  "task:skipped",
  "task:reopened",
  "task:started",
  "team_post:pinned",
  "team_post:unpinned",
  ...["standard", "document"].flatMap((kind) =>
    ["acknowledged", "archived", "published", "updated", "versioned", "drafted"].map((action) => `${kind}:${action}`),
  ),
  "user_mfa:enabled",
  "user_mfa:disabled",
  "user_mfa:reset",
  "user_mfa:recovery_regenerated",
  "user_passkey:registered",
  "user_passkey:removed",
  "shared_file:uploaded",
  "shared_file:shared",
  "shared_file:updated",
  "shared_file:deleted",
  ...["restored", "purged", "moved", "copied", "versioned", "version_restored"].map(
    (action) => `shared_file:${action}`,
  ),
  ...["created", "renamed", "moved", "deleted", "restored", "purged"].map((action) => `shared_folder:${action}`),
  "care_supply_product:created",
  "care_supply_product:updated",
  "ai_draft:accepted",
  "ai_draft:discarded",
  "ai_draft:reviewed",
  "medication:btm_marked",
  "medication:btm_unmarked",
  "user:lock",
  "user:restore",
  "user:deleted",
  "end_of_life_wishes:created",
  "end_of_life_wishes:updated",
  "death_checklist:item_done",
  "death_checklist:item_reopened",
  ...["departed", "returned", "departure_undone", "return_undone"].map((action) => `resident_appointment:${action}`),
  "onboarding:step_signed",
  "onboarding:step_reopened",
];

test("Änderungsprotokoll: jede protokollierte Aktion hat eine deutsche Bezeichnung", () => {
  const pairs = [...loggedPairs(), ...COMPUTED];
  assert.ok(pairs.length > 80, `nur ${pairs.length} Aktionen gefunden`);
  const missing = pairs.filter((pair) => {
    const [entity, action] = pair.split(":");
    return !(entity in AUDIT_AREAS) || !auditActionKnown(entity, action);
  });
  assert.deepEqual(missing, []);
});

test("Änderungsprotokoll: Land der Einrichtung lesbar statt technischer Schlüssel", () => {
  assert.equal(auditTitle("organization", "country_updated", terms), "Land und Region der Einrichtung geändert");
  assert.deepEqual(
    auditChanges("organization", "country_updated", { country: "CH", region: "ZH" }, { country: "DE", region: "BY" }),
    [
      { field: "Land", before: "Schweiz", after: "Deutschland" },
      { field: "Kanton / Bundesland", before: "Zürich", after: "Bayern" },
    ],
  );
});

test("Änderungsprotokoll: Titel, Einstellungen, Werte und verborgene Kennungen", () => {
  assert.equal(auditTitle("role", "created", terms), "Rolle erstellt");
  assert.equal(auditTitle("care_plan", "status_closed", terms), "Pflegeplan abgeschlossen");
  assert.equal(auditTitle("resident", "stay_hospital", terms), "Aufenthalt: Spitalaufenthalt");
  assert.equal(auditTitle("resident", "imported", termsFor("patient")), "Patient importiert");
  assert.equal(auditTitle("unbekannt", "irgendwas_neues", terms), "Eintrag geändert");
  assert.equal(auditSettingTitle("terminology"), "Bezeichnung der betreuten Personen");
  assert.equal(auditSettingTitle("hidden_vitals"), "Erfasste Vitalwerte");
  assert.deepEqual(
    auditChanges("setting", "strongLoginRequired", { value: null, enabled: false }, { value: null, enabled: true }),
    [{ field: "Eingeschaltet", before: "ausgeschaltet", after: "eingeschaltet" }],
  );
  assert.deepEqual(auditChanges("setting", "terminology", { value: "patient" }, { value: "resident" }), [
    { field: "Wert", before: "Patient", after: "Bewohner" },
  ]);
  const changes = auditChanges("medication_interaction", "created", null, {
    severity: "moderate",
    substanceA: "Alpha",
    residentId: "12c5b796-d878-4f87-a98e-67e7dad39d4f",
    mimeType: "image/png",
    rows: [{ metric: "Gewicht" }],
  });
  assert.deepEqual(changes, [
    { field: "Schweregrad", before: "–", after: "Mittel" },
    { field: "Wirkstoff A", before: "–", after: "Alpha" },
  ]);
  assert.deepEqual(auditChanges("portal_grant", "revoked", { areas: ["medication", "emergency"] }, null), [
    { field: "Bereiche", before: "Medikation, Notfalldaten", after: "–" },
  ]);
  assert.deepEqual(
    auditChanges("care_plan", "updated", { reviewOn: "2026-11-01T00:00:00.000Z" }, { reviewOn: "2026-11-01" }),
    [],
  );
  assert.deepEqual(auditChanges("language", "released", null, { locale: "en" }), [
    { field: "Sprache", before: "–", after: "Englisch" },
  ]);
});

test("Protokoll der Bewohnerakte: deutsche Titel auch für Aufgaben, Übergaben, Portal und Ereignisse", () => {
  const title = (entityType: string, action: string) =>
    describeAudit({ id: "x", createdAt: "", actor: "", entityType, action, before: null, after: null }).title;
  assert.equal(title("handover", "created"), "Übergabe erstellt");
  assert.equal(title("task", "escalated"), "Aufgabe eskaliert");
  assert.equal(title("quality_event", "reported"), "Ereignis gemeldet");
  assert.equal(title("portal_grant", "revoked"), "Portalfreigabe widerrufen");
  assert.equal(title("ai_draft", "created"), "KI-Entwurf erstellt");
  assert.equal(title("resident", "stay_hospital"), "Aufenthalt: Spitalaufenthalt");
  assert.equal(title("medication_administration", "effect_checked"), "Wirkungskontrolle erfasst");
  assert.equal(title("wound", "created"), "Wunde angelegt");
  for (const [entity, action] of [
    ["resident_transfer", "created"],
    ["pharmacy_order", "created"],
    ["unbekannt", "neu_erfasst"],
  ])
    assert.doesNotMatch(title(entity, action), /_|\b(created|updated|reported)\b/);
});
