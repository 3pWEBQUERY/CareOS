import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ApiContext } from "@/lib/api-context";
import type { PortalActor } from "@/lib/portal";
import { createPortalAccount, createPortalGrant } from "@/lib/portal-admin";
import { portalSend, portalThread, portalThreads, staffSend, staffThread, staffThreads } from "@/lib/portal-messages";
import { cancelOrder, createOrder, listOrders, pharmacyOrders, updateOrderByPharmacy } from "@/lib/pharmacy";
import { apiContextFor, createResident, fixture, q, type Fixture } from "../support/db";

const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: Error) => error.message,
  );

async function withPermissions(f: Fixture, person: string, extra: string[]): Promise<ApiContext> {
  const ctx = await apiContextFor(f, person);
  return { ...ctx, actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, ...extra] } };
}

const actorFor = (ctx: ApiContext, id: string, kind: PortalActor["kind"], name: string): PortalActor => ({
  id,
  organizationId: ctx.actor.organizationId,
  kind,
  displayName: name,
  mustChangePassword: false,
  userAgent: "test",
});

test("Portal-Nachrichten: nur mit Freigabe „Nachrichten“, Pflege des Wohnbereichs antwortet, gelesen/ungelesen", async () => {
  const f = await fixture();
  const admin = await withPermissions(f, "leadA", ["administration.manage", "residents.write"]);
  const nurse = await withPermissions(f, "anna", ["residents.write"]);
  const other = await withPermissions(await fixture(), "anna", ["residents.write"]);
  const resident = await createResident(f, "Erna Muster");
  const { id } = await createPortalAccount(admin, {
    kind: "relative",
    displayName: "Petra Muster",
    username: `petra-${randomUUID().slice(0, 8)}`,
  });
  const petra = actorFor(admin, id, "relative", "Petra Muster");
  const grant = await createPortalGrant(admin, id, { residentId: resident, areas: ["medication"], basis: "consent" });
  assert.equal(
    await rejected(portalSend(admin.sql, petra, { subject: "Besuch", residentId: resident, body: "Hallo" })),
    "Für diese Person sind keine Nachrichten freigegeben.",
  );
  await q(`UPDATE carecore_portal_grants SET areas = '["medication","messages"]'::jsonb WHERE id = $1`, [grant]);
  const threadId = await portalSend(admin.sql, petra, {
    subject: "Besuch am Sonntag",
    residentId: resident,
    body: "Darf ich um 14 Uhr kommen?",
  });

  // Anna arbeitet im Wohnbereich A (dort wohnt Erna): Benachrichtigung und ungelesene Unterhaltung.
  const [notice] = await q<{ type: string; link_url: string }>(
    `SELECT type, link_url FROM carecore_notifications WHERE user_id = $1 AND entity_id = $2`,
    [f.people.anna, threadId],
  );
  assert.equal(notice.type, "message_portal");
  assert.ok(notice.link_url.includes(threadId));
  assert.equal((await staffThreads(nurse)).find((thread) => thread.id === threadId)?.unread, true);
  assert.equal(
    (await q(`SELECT 1 FROM carecore_notifications WHERE user_id = $1 AND entity_id = $2`, [f.people.ben, threadId]))
      .length,
    0,
    "Ben arbeitet in Wohnbereich B",
  );

  const opened = await staffThread(nurse, threadId);
  assert.equal(opened.messages?.[0].body, "Darf ich um 14 Uhr kommen?");
  await staffSend(nurse, { threadId, body: "Gerne, bis Sonntag." });
  assert.equal((await staffThreads(nurse)).find((thread) => thread.id === threadId)?.unread, false);
  assert.equal((await portalThreads(admin.sql, petra))[0].unread, true, "Antwort ungelesen im Portal");
  const seen = await portalThread(admin.sql, petra, threadId);
  assert.deepEqual(
    seen.messages?.map((message) => [message.sender, message.senderName]),
    [
      ["portal", "Petra Muster"],
      ["staff", "Anna Müller"],
    ],
  );
  assert.equal((await portalThreads(admin.sql, petra))[0].unread, false);

  // Fremde Einrichtung und fremder Zugang sehen nichts.
  assert.equal((await staffThreads(other)).length, 0);
  assert.equal(await rejected(staffThread(other, threadId)), "Unterhaltung nicht gefunden.");
  const stranger = actorFor(admin, randomUUID(), "relative", "Fremd");
  assert.equal(await rejected(portalThread(admin.sql, stranger, threadId)), "Unterhaltung nicht gefunden.");
  const log = await q<{ action: string }>(`SELECT action FROM carecore_portal_access_log WHERE account_id = $1`, [id]);
  assert.ok(log.some((entry) => entry.action === "message_sent"));
});

test("Apothekenportal: Bestellung erfassen, Apotheke bestätigt und liefert, Ablehnung nur mit Grund", async () => {
  const f = await fixture();
  const admin = await withPermissions(f, "leadA", ["administration.manage", "medication.manage"]);
  const nurse = await apiContextFor(f, "anna");
  const { id } = await createPortalAccount(admin, {
    kind: "pharmacy",
    displayName: "Apotheke am Platz",
    username: `apotheke-${randomUUID().slice(0, 8)}`,
  });
  const pharmacy = actorFor(admin, id, "pharmacy", "Apotheke am Platz");
  const relative = actorFor(admin, randomUUID(), "relative", "Angehörige");

  assert.equal(
    await rejected(createOrder(nurse, { pharmacyId: id, items: [{ medication: "X", quantity: 1, unit: "Pck" }] })),
    "Bestellungen bei der Apotheke verwaltet, wer Verordnungen verwalten darf.",
  );
  assert.equal(
    await rejected(
      createOrder(admin, { pharmacyId: id, items: [{ medication: "Metformin", quantity: 0, unit: "Pck" }] }),
    ),
    "Bitte eine gültige Menge für „Metformin“ angeben.",
  );
  const orderId = await createOrder(admin, {
    pharmacyId: id,
    careUnitId: f.units.a,
    note: "Bitte bis Freitag",
    items: [
      { medication: "Metformin", strength: "500 mg", quantity: 2, unit: "Packungen" },
      { medication: "Paracetamol", strength: "500 mg", quantity: 1, unit: "Packung" },
    ],
  });
  assert.equal(await rejected(pharmacyOrders(admin.sql, relative)), "Bestellungen sehen nur Apotheken.");
  const [seen] = await pharmacyOrders(admin.sql, pharmacy);
  assert.equal(seen.status, "open");
  assert.equal(seen.careUnit, "Wohngruppe A");
  assert.deepEqual(
    seen.items.map((item) => [item.medication, item.quantity]),
    [
      ["Metformin", 2],
      ["Paracetamol", 1],
    ],
  );

  assert.equal(
    await rejected(updateOrderByPharmacy(admin.sql, pharmacy, orderId, { status: "rejected" })),
    "Bitte einen Grund für die Ablehnung angeben.",
  );
  await updateOrderByPharmacy(admin.sql, pharmacy, orderId, { status: "confirmed", expectedOn: "2026-10-02" });
  await updateOrderByPharmacy(admin.sql, pharmacy, orderId, { status: "delivered", note: "Geliefert mit Kurier" });
  assert.equal(
    await rejected(updateOrderByPharmacy(admin.sql, pharmacy, orderId, { status: "confirmed" })),
    "Die Bestellung ist bereits „Geliefert“.",
  );
  const [done] = await listOrders(admin);
  assert.deepEqual(
    [done.status, done.expectedOn, done.pharmacyNote],
    ["delivered", "2026-10-02", "Geliefert mit Kurier"],
  );
  assert.equal(
    await rejected(cancelOrder(admin, orderId)),
    "Nur offene oder bestätigte Bestellungen lassen sich stornieren.",
  );
  const notes = await q<{ title: string }>(
    `SELECT title FROM carecore_notifications WHERE user_id = $1 AND entity_id = $2 ORDER BY created_at`,
    [f.people.leadA, orderId],
  );
  assert.deepEqual(
    notes.map((note) => note.title),
    ["Apotheke Apotheke am Platz: Bestellung bestätigt", "Apotheke Apotheke am Platz: Bestellung geliefert"],
    "Leitung verwaltet Verordnungen und erfährt jeden Schritt",
  );
});
