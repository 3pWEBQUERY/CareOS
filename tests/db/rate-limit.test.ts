import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { consumeWrite } from "@/lib/rate-limit";
import { apiContextFor, fixture, q } from "../support/db";

test("Drossel: Zähler je Schlüssel und Minute, darüber abgelehnt mit Wartezeit", async () => {
  const { sql } = await apiContextFor(await fixture(), "anna");
  const key = `s:${randomUUID().replace(/-/g, "")}`;
  const other = `s:${randomUUID().replace(/-/g, "")}`;
  for (let i = 1; i <= 3; i += 1) {
    const result = await consumeWrite(sql, key, 3);
    assert.equal(result.allowed, true);
    assert.equal(result.count, i);
  }
  const blocked = await consumeWrite(sql, key, 3);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 60);
  // Andere Sitzungen sind nicht betroffen.
  assert.equal((await consumeWrite(sql, other, 3)).allowed, true);

  // Neue Minute: der Zähler beginnt von vorn.
  await q("UPDATE carecore_rate_limits SET window_start = window_start - INTERVAL '1 minute' WHERE key = $1", [key]);
  const fresh = await consumeWrite(sql, key, 3);
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.count, 1);
});
