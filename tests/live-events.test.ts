import { test } from "node:test";
import assert from "node:assert/strict";
import { changedChannels, decodeSnapshot, encodeSnapshot } from "../lib/live-events.ts";

test("Echtzeit: Stand als Event-ID, geänderte Kanäle nach dem Wiederverbinden", () => {
  const before = { notifications: "0|a|b", messages: "x", work: "1" };
  const id = encodeSnapshot(before);
  assert.match(id, /^[A-Za-z0-9_-]+$/, "ohne Zeilenumbrüche und Doppelpunkte");
  assert.deepEqual(decodeSnapshot(id), before);
  assert.equal(decodeSnapshot("kaputt"), null);
  assert.equal(decodeSnapshot(null), null);
  assert.deepEqual(changedChannels(null, before), [], "erste Verbindung meldet nur „ready“");
  assert.deepEqual(changedChannels(before, { ...before, notifications: "1|c|b", work: "2" }), [
    "notifications",
    "work",
  ]);
});
