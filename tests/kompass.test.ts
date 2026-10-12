import { test } from "node:test";
import assert from "node:assert/strict";
import { GOAL_CATEGORIES } from "../lib/care-planning-shared.ts";
import {
  ITEM_BY_KEY,
  KOMPASS_DOMAINS,
  KOMPASS_ITEMS,
  NOT_APPLICABLE,
  SCALES,
  answerRank,
  domainProgress,
  domainSummary,
  emptyKompass,
  kompassProgress,
  optionLabel,
  validAnswer,
} from "../lib/kompass-instrument.ts";

test("Kompass: eindeutige Fragen, Kategorien der Pflegeplanung, keine Punktwerte in den Skalen", () => {
  assert.equal(new Set(KOMPASS_DOMAINS.map((domain) => domain.id)).size, KOMPASS_DOMAINS.length);
  assert.equal(new Set(KOMPASS_ITEMS.map((item) => item.key)).size, KOMPASS_ITEMS.length);
  for (const domain of KOMPASS_DOMAINS) {
    assert.ok(domain.items.length > 0, domain.title);
    assert.ok((GOAL_CATEGORIES as readonly string[]).includes(domain.planCategory), domain.title);
  }
  // Beschreibende Stufen mit Erklärung, keine Zahlen als Bezeichnung.
  for (const scale of Object.values(SCALES))
    for (const option of scale.options) {
      assert.doesNotMatch(option.label, /\d/);
      assert.ok(option.hint.length > 10, option.label);
    }
});

test("Kompass: gültige Antworten, „Trifft nicht zu“ nur wo vorgesehen, Rang für den Vergleich", () => {
  const transfer = ITEM_BY_KEY.get("mobility.transfer")!;
  const stairs = ITEM_BY_KEY.get("mobility.stairs")!;
  const injection = ITEM_BY_KEY.get("treatment.injection")!;
  assert.equal(validAnswer(transfer, "2"), true);
  assert.equal(validAnswer(transfer, "7"), false);
  assert.equal(validAnswer(transfer, 2), false);
  assert.equal(validAnswer(transfer, NOT_APPLICABLE), false);
  assert.equal(validAnswer(stairs, NOT_APPLICABLE), true);
  assert.equal(validAnswer(injection, "nurse"), true);
  assert.equal(optionLabel(transfer, "2"), "Teilweise Hilfe");
  assert.equal(optionLabel(stairs, NOT_APPLICABLE), "Trifft nicht zu");
  assert.equal(optionLabel(transfer, undefined), null);
  assert.equal(answerRank(injection, "none"), 0);
  assert.equal(answerRank(injection, "nurse"), 3);
  assert.equal(answerRank(stairs, NOT_APPLICABLE), null);
});

test("Kompass: Fortschritt zählt Fragen und den Entscheid über den Handlungsbedarf", () => {
  const data = emptyKompass("admission", "2026-10-06");
  assert.equal(kompassProgress(data), 0);
  const mobility = KOMPASS_DOMAINS.find((domain) => domain.id === "mobility")!;
  for (const item of mobility.items) data.answers[`mobility.${item.id}`] = item.allowNa ? NOT_APPLICABLE : "0";
  assert.deepEqual(domainProgress(mobility, data), { answered: 5, total: 5, decided: false, complete: false });
  // Handlungsbedarf „Ja“ zählt erst mit Beschreibung.
  data.domains.mobility = { need: true };
  assert.equal(domainProgress(mobility, data).decided, false);
  data.domains.mobility = { need: true, needText: "Begleitung beim Aufstehen" };
  assert.equal(domainProgress(mobility, data).complete, true);
  data.answers["mobility.transfer"] = "3";
  assert.deepEqual(domainSummary(mobility, data.answers), { answered: 4, withSupport: 1 });
  for (const domain of KOMPASS_DOMAINS) {
    for (const item of domain.items) data.answers[`${domain.id}.${item.id}`] = SCALES[item.scale].options[0].value;
    data.domains[domain.id] = { ...data.domains[domain.id], need: data.domains[domain.id]?.need ?? false };
  }
  assert.equal(kompassProgress(data), 100);
});
