import { test } from "node:test";
import assert from "node:assert/strict";
import { managedUnitIds, rosterCan, visibleUnitIds, type RosterAccess } from "@/lib/roster/permissions";

const access = (overrides: Partial<RosterAccess>): RosterAccess => ({
  userId: "u",
  isAdmin: false,
  canManage: false,
  leadUnitIds: [],
  memberUnitIds: [],
  allUnitIds: ["a", "b", "c"],
  ...overrides,
});

test("Leitung plant nur die eigenen Wohnbereiche", () => {
  const lead = access({ canManage: true, leadUnitIds: ["a"], memberUnitIds: ["a"] });
  assert.deepEqual(managedUnitIds(lead), ["a"]);
  assert.equal(rosterCan(lead, "dienstplan:update", "a"), true);
  assert.equal(rosterCan(lead, "dienstplan:update", "b"), false);
  assert.equal(rosterCan(lead, "dienstplan:publish", "a"), true);
  assert.equal(rosterCan(lead, "audit:read", "a"), true);
});

test("Leitungs-Mitgliedschaft ohne Planungsrecht der Rolle reicht nicht", () => {
  const withoutRole = access({ canManage: false, leadUnitIds: ["a"], memberUnitIds: ["a"] });
  assert.deepEqual(managedUnitIds(withoutRole), []);
  assert.equal(rosterCan(withoutRole, "dienstplan:update", "a"), false);
});

test("Mitarbeitende: eigene Anträge und Stempeln, aber keine Planung", () => {
  const staff = access({ memberUnitIds: ["b"] });
  assert.equal(rosterCan(staff, "dienstplan:read_own", "b"), true);
  assert.equal(rosterCan(staff, "wunschfrei:create", "b"), true);
  assert.equal(rosterCan(staff, "diensttausch:create", "b"), true);
  assert.equal(rosterCan(staff, "zeiterfassung:write_own", "b"), true);
  assert.equal(rosterCan(staff, "dienstplan:read", "b"), false);
  assert.equal(rosterCan(staff, "wunschfrei:decide", "b"), false);
  assert.equal(rosterCan(staff, "ki:use", "b"), false);
  assert.equal(rosterCan(staff, "dienstplan:read_own", "a"), false);
});

test("Administration leitet alle Wohnbereiche und pflegt organisationsweite Einstellungen", () => {
  const admin = access({ isAdmin: true });
  assert.deepEqual(managedUnitIds(admin), ["a", "b", "c"]);
  assert.equal(rosterCan(admin, "regelwerk:manage"), true);
  assert.equal(rosterCan(access({ canManage: true, leadUnitIds: ["a"] }), "regelwerk:manage"), false);
  assert.equal(rosterCan(access({ canManage: true, leadUnitIds: ["a"] }), "regelwerk:manage", "a"), true);
});

test("sichtbare Wohnbereiche: geleitete und eigene", () => {
  const person = access({ canManage: true, leadUnitIds: ["a"], memberUnitIds: ["b"] });
  assert.deepEqual(visibleUnitIds(person).sort(), ["a", "b"]);
});
