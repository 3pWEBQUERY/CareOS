import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ApiContext } from "@/lib/api-context";
import {
  authenticatePortal,
  changePortalPassword,
  portalResidentDetail,
  portalResidents,
  type PortalActor,
} from "@/lib/portal";
import {
  createPortalAccount,
  createPortalGrant,
  listPortalAccounts,
  portalAccessLog,
  revokePortalGrant,
  updatePortalAccount,
  updatePortalGrant,
} from "@/lib/portal-admin";
import { createOrder, parseOrderInput } from "@/lib/medication-orders";
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

const actorFor = (ctx: ApiContext, id: string): PortalActor => ({
  id,
  organizationId: ctx.actor.organizationId,
  kind: "relative",
  displayName: "Test",
  mustChangePassword: false,
  userAgent: "test",
});

test("Portal: Zugang mit Einmal-Passwort, Passwortwechsel, nur Administration, nur eigene Einrichtung", async () => {
  const f = await fixture();
  const other = await fixture();
  const ctx = await admin(f);
  const username = `angehoerige-${randomUUID().slice(0, 8)}`;
  assert.equal(
    await rejected(
      createPortalAccount(await apiContextFor(f, "anna"), { kind: "relative", displayName: "X", username }),
    ),
    "Das Portal verwaltet die Administration.",
  );
  const { id, password } = await createPortalAccount(ctx, {
    kind: "relative",
    displayName: "Petra Muster",
    username: username.toUpperCase(),
    email: "petra@example.org",
  });
  assert.match(password, /^[\w]{4}(-[\w]{4})+$/);
  assert.equal(
    await rejected(createPortalAccount(ctx, { kind: "relative", displayName: "Doppelt", username })),
    "Dieser Benutzername ist bereits vergeben.",
  );
  const [staff] = await q<{ username: string }>(`SELECT username FROM carecore_users WHERE id = $1`, [f.people.anna]);
  assert.equal(
    await rejected(createPortalAccount(ctx, { kind: "physician", displayName: "Kollision", username: staff.username })),
    "Dieser Benutzername ist bereits vergeben.",
    "kein Benutzername einer Mitarbeiterin",
  );

  assert.equal(await authenticatePortal(ctx.sql, username, "falsch"), null);
  assert.equal(await authenticatePortal(ctx.sql, username.toUpperCase(), password), id);
  const [row] = await q<{ must_change_password: boolean }>(
    `SELECT must_change_password FROM carecore_portal_accounts WHERE id = $1`,
    [id],
  );
  assert.equal(row.must_change_password, true);
  const actor = actorFor(ctx, id);
  assert.equal(
    await rejected(changePortalPassword(ctx.sql, actor, password, "kurz1")),
    "Das Passwort braucht mindestens 12 Zeichen.",
  );
  assert.equal(
    await rejected(changePortalPassword(ctx.sql, actor, "falsch", "Neues-Passwort-2026")),
    "Das bisherige Passwort stimmt nicht.",
  );
  await changePortalPassword(ctx.sql, actor, password, "Neues-Passwort-2026");
  assert.equal(await authenticatePortal(ctx.sql, username, password), null, "Einmal-Passwort gilt nicht mehr");
  assert.equal(await authenticatePortal(ctx.sql, username, "Neues-Passwort-2026"), id);

  // Andere Einrichtung sieht den Zugang nicht und kann ihn nicht ändern.
  const foreign = await admin(other);
  assert.equal((await listPortalAccounts(foreign)).accounts.length, 0);
  assert.equal(
    await rejected(updatePortalAccount(foreign, id, { displayName: "Übernommen" })),
    "Portal-Zugang nicht gefunden.",
  );

  // Gesperrt: keine Anmeldung mehr.
  await updatePortalAccount(ctx, id, { displayName: "Petra Muster", active: false });
  assert.equal(await authenticatePortal(ctx.sql, username, "Neues-Passwort-2026"), null);
  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'portal_account' AND entity_id = $1 ORDER BY created_at`,
    [id],
  );
  assert.deepEqual(
    audit.map((entry) => entry.action),
    ["created", "deactivated"],
  );
});

test("Portal: nur freigegebene Personen und Bereiche, Zeitraum, Wohnbereich, Widerruf, Zugriffe protokolliert", async () => {
  const f = await fixture();
  const ctx = await admin(f);
  const erna = await createResident(f, "Erna Muster");
  const hans = await createResident(f, "Hans Beispiel");
  const other = await createResident(f, "Olga Andere");
  await q(`UPDATE carecore_resident_stays SET care_unit_id = $2 WHERE resident_id = $1`, [other, f.units.b]);
  await createOrder(
    ctx,
    erna,
    parseOrderInput({
      name: "Metformin",
      amount: "1 Tablette",
      prescribedBy: "Dr. A",
      startOn: "2026-01-01",
      times: ["08:00"],
    }),
  );
  await q(
    `INSERT INTO carecore_vital_measurements (id, resident_id, measured_at, metric, value, unit) VALUES ($1, $2, NOW(), 'Puls', 72, '/min')`,
    [randomUUID(), erna],
  );
  const { id } = await createPortalAccount(ctx, {
    kind: "relative",
    displayName: "Sohn",
    username: `sohn-${randomUUID().slice(0, 8)}`,
  });
  const actor = actorFor(ctx, id);
  assert.deepEqual(await portalResidents(ctx.sql, actor), [], "ohne Freigabe nichts");

  assert.equal(
    await rejected(createPortalGrant(ctx, id, { residentId: erna, areas: [], basis: "consent" })),
    "Bitte mindestens einen Bereich freigeben.",
  );
  assert.equal(
    await rejected(createPortalGrant(ctx, id, { residentId: erna, areas: ["medication"] })),
    "Bitte die Grundlage der Freigabe wählen.",
  );
  const grant = await createPortalGrant(ctx, id, {
    residentId: erna,
    areas: ["medication", "unbekannt"],
    basis: "consent",
    basisNote: "schriftlich vom 30.09.2026",
  });
  const visible = await portalResidents(ctx.sql, actor);
  assert.deepEqual(
    visible.map((entry) => entry.name),
    ["Erna Muster"],
  );
  assert.deepEqual(visible[0].areas, ["medication"]);
  const detail = await portalResidentDetail(ctx.sql, actor, erna);
  assert.equal(detail.medication?.[0].name, "Metformin");
  assert.equal(detail.vitals, undefined, "Vitalwerte nicht freigegeben");
  assert.equal(detail.emergency, undefined);
  assert.equal(await rejected(portalResidentDetail(ctx.sql, actor, hans)), "Keine Freigabe für diese Person.");

  // Mehr Bereiche; Zeitraum in der Zukunft blendet aus.
  await updatePortalGrant(ctx, grant, { residentId: erna, areas: ["medication", "vitals"], basis: "consent" });
  assert.equal((await portalResidentDetail(ctx.sql, actor, erna)).vitals?.[0].value, "72");
  await updatePortalGrant(ctx, grant, {
    residentId: erna,
    areas: ["medication"],
    basis: "consent",
    validFrom: "2999-01-01",
  });
  assert.deepEqual(await portalResidents(ctx.sql, actor), []);

  // Wohnbereich A: alle, die dort wohnen – nicht Olga aus Wohnbereich B.
  const unitGrant = await createPortalGrant(ctx, id, {
    careUnitId: f.units.a,
    areas: ["appointments"],
    basis: "treatment",
  });
  assert.deepEqual((await portalResidents(ctx.sql, actor)).map((entry) => entry.name).sort(), [
    "Erna Muster",
    "Hans Beispiel",
  ]);
  await revokePortalGrant(ctx, unitGrant);
  assert.deepEqual(await portalResidents(ctx.sql, actor), []);
  assert.equal(await rejected(revokePortalGrant(ctx, unitGrant)), "Die Freigabe ist bereits widerrufen.");

  const log = await portalAccessLog(ctx, id);
  assert.ok(log.length >= 2);
  assert.ok(log.every((entry) => entry.action === "resident_viewed" && entry.residentName === "Erna Muster"));
});
