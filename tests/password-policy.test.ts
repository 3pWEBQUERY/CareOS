import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordPolicyError } from "../lib/password-policy.ts";

test("Passwort-Richtlinie: Länge, Sperrliste, Vielfalt, eigener Name", () => {
  assert.match(passwordPolicyError("kurz") ?? "", /mindestens 10/);
  assert.match(passwordPolicyError("abcdefghijk", { minLength: 14 }) ?? "", /mindestens 14/);
  assert.match(passwordPolicyError("Qwertzuiop") ?? "", /verbreitet/);
  assert.match(passwordPolicyError("aaaaaaaaaaaa") ?? "", /4 verschiedene/);
  assert.match(passwordPolicyError("Laura-2026-Pflege", { displayName: "Laura Leitung" }) ?? "", /Namen/);
  assert.match(passwordPolicyError("x-lena.b-2026!", { username: "lena.b" }) ?? "", /Benutzernamen/);
  assert.equal(passwordPolicyError("Sonnige-Treppe-48", { username: "lena.b", displayName: "Lena Bucher" }), null);
  // Eine Mindestlänge unter 10 gilt nicht.
  assert.match(passwordPolicyError("abc4efg8", { minLength: 6 }) ?? "", /mindestens 10/);
});
