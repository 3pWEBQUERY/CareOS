import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, careLevelOptions, countryCode, insuranceNumberError, socialNumberError } from "../lib/country.ts";
import { publicHolidays } from "../lib/holidays.ts";

test("Einstufung je Land: CH 12 Pflegestufen, DE 5 Pflegegrade, AT 7 Pflegegeldstufen", () => {
  const ch = COUNTRIES.CH.careLevels.levels;
  assert.equal(ch.length, 12);
  assert.deepEqual(ch[0], { value: "Pflegestufe 1", detail: "bis 20 Minuten" });
  assert.equal(ch[1].detail, "21 bis 40 Minuten");
  assert.equal(ch[11].detail, "mehr als 220 Minuten");
  const de = COUNTRIES.DE.careLevels.levels;
  assert.deepEqual(
    de.map((level) => level.value),
    ["Pflegegrad 1", "Pflegegrad 2", "Pflegegrad 3", "Pflegegrad 4", "Pflegegrad 5"],
  );
  assert.match(de[2].detail, /^47,5 bis unter 70 Punkte/);
  const at = COUNTRIES.AT.careLevels.levels;
  assert.equal(at.length, 7);
  assert.equal(at[0].detail, "mehr als 65 Stunden");
  assert.equal(at[1].detail, "mehr als 95 Stunden");
});

test("Auswahl behält einen Wert aus einem anderen Land; unbekanntes Land ist die Schweiz", () => {
  assert.equal(careLevelOptions("DE", "Pflegestufe 4")[0], "Pflegestufe 4");
  assert.equal(careLevelOptions("DE", "Pflegegrad 2").length, 5);
  assert.equal(countryCode("FR"), "CH");
  assert.equal(countryCode("AT"), "AT");
});

test("Sozialversicherungsnummer im Format des Landes", () => {
  assert.equal(socialNumberError("CH", "756.1234.5678.97"), null);
  assert.match(socialNumberError("CH", "123.4567.8901.23") ?? "", /AHV/);
  assert.equal(socialNumberError("DE", "12 010150 M 123"), null);
  assert.notEqual(socialNumberError("DE", "1201015012"), null);
  // Österreich: Prüfziffer an vierter Stelle.
  assert.equal(socialNumberError("AT", "1237 010180"), null);
  assert.match(socialNumberError("AT", "1234 010180") ?? "", /Prüfziffer/);
  assert.notEqual(socialNumberError("AT", "12345"), null);
  assert.equal(insuranceNumberError("DE", "A123456789"), null);
  assert.notEqual(insuranceNumberError("DE", "123456789"), null);
  assert.equal(insuranceNumberError("CH", "beliebig"), null);
});

test("Feiertage je Land, Kanton und Bundesland", () => {
  const names = (country: "CH" | "DE" | "AT", region: string | null) =>
    Object.fromEntries(publicHolidays(country, region, 2026).map((h) => [h.date, h.name]));
  const zh = names("CH", "ZH");
  assert.equal(zh["2026-04-03"], "Karfreitag");
  assert.equal(zh["2026-08-01"], "Bundesfeiertag");
  assert.equal(zh["2026-06-04"], undefined, "Fronleichnam nicht im Kanton Zürich");
  assert.equal(names("CH", "LU")["2026-06-04"], "Fronleichnam");
  assert.equal(names("CH", "VD")["2026-09-21"], "Bettagsmontag", "deutsche Namen auch in der Romandie");
  const de = names("DE", null);
  assert.equal(Object.keys(de).length, 9);
  assert.equal(de["2026-10-03"], "Tag der Deutschen Einheit");
  assert.equal(names("DE", "BY")["2026-11-01"], "Allerheiligen");
  assert.equal(names("DE", "BE")["2026-03-08"], "Internationaler Frauentag");
  assert.equal(names("DE", "SN")["2026-11-18"], "Buß- und Bettag");
  assert.equal(names("DE", "HH")["2026-11-01"], undefined);
  const at = names("AT", null);
  assert.equal(Object.keys(at).length, 13);
  assert.equal(at["2026-10-26"], "Nationalfeiertag");
});
