import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WRITE_LIMIT_PER_MINUTE, isThrottledWrite, rateLimitKey, writeLimit } from "@/lib/rate-limit";

test("Drossel: nur schreibende API-Anfragen, Anmeldung und Zeitplan ausgenommen", () => {
  assert.equal(isThrottledWrite("POST", "/api/documentation"), true);
  assert.equal(isThrottledWrite("delete", "/api/dashboard/notes"), true);
  assert.equal(isThrottledWrite("GET", "/api/documentation"), false);
  assert.equal(isThrottledWrite("POST", "/api/auth/login"), false);
  assert.equal(isThrottledWrite("GET", "/api/push/dispatch"), false);
  assert.equal(isThrottledWrite("POST", "/c/pflegedokumentation"), false);
});

test("Drossel: Schlüssel ohne Klartext, je Sitzung oder IP", () => {
  const session = rateLimitKey("geheimes-token", "10.0.0.1");
  assert.match(session, /^s:[0-9a-f]{40}$/);
  assert.ok(!session.includes("geheimes"));
  assert.equal(rateLimitKey("geheimes-token", "10.0.0.2"), session);
  assert.match(rateLimitKey(undefined, "10.0.0.1"), /^ip:[0-9a-f]{40}$/);
  assert.notEqual(rateLimitKey(undefined, "10.0.0.1"), rateLimitKey(undefined, "10.0.0.2"));
});

test("Drossel: Grenze aus der Umgebung, sonst Standard", () => {
  const before = process.env.CARECORE_WRITE_LIMIT_PER_MINUTE;
  process.env.CARECORE_WRITE_LIMIT_PER_MINUTE = "30";
  assert.equal(writeLimit(), 30);
  process.env.CARECORE_WRITE_LIMIT_PER_MINUTE = "abc";
  assert.equal(writeLimit(), DEFAULT_WRITE_LIMIT_PER_MINUTE);
  if (before === undefined) delete process.env.CARECORE_WRITE_LIMIT_PER_MINUTE;
  else process.env.CARECORE_WRITE_LIMIT_PER_MINUTE = before;
});
