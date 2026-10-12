import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import type { Permission } from "@/lib/server-data";
import {
  activityDetail,
  activityReport,
  activityWeek,
  cancelActivity,
  createActivity,
  recordParticipation,
  updateActivity,
} from "@/lib/activities";
import { activityLeaderSettings, saveActivityLeaders } from "@/lib/activity-leaders";
import { portalResidentDetail, type PortalActor } from "@/lib/portal";
import { createPortalAccount, createPortalGrant } from "@/lib/portal-admin";
import { apiContextFor, createResident, fixture, q } from "../support/db";

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  assert.fail("Fehler erwartet");
}

const withPermission = (ctx: ApiContext, ...permissions: Permission[]): ApiContext => ({
  ...ctx,
  actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, ...permissions] },
});

// Zeitpunkt relativ zu jetzt, auf volle Minuten.
const at = (hours: number) => new Date(Math.floor((Date.now() + hours * 3_600_000) / 60_000) * 60_000).toISOString();
const zurichDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));

test("Alltag & Aktivierung: planen, wöchentlich wiederholen, Teilnahme, Absage, Monatsübersicht und Portal", async () => {
  const f = await fixture();
  const reader = await apiContextFor(f, "anna");
  const ctx = withPermission(reader, "documentation.write");
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const base = {
    title: "Singnachmittag",
    category: "Musik & Singen",
    careUnitId: f.units.a,
    startsAt: at(-2),
    durationMinutes: 60,
    location: "Aufenthaltsraum",
    leader: "Lea Beispiel",
  };

  assert.equal((await failure(createActivity(reader, base))).status, 403);
  // Leitung nur aus der Zuteilung der Administration.
  assert.match((await failure(createActivity(ctx, base))).message, /Leitung aus der Liste/);
  const admin = withPermission(await apiContextFor(f, "leadA"), "administration.manage");
  assert.equal((await failure(saveActivityLeaders(ctx, { leaderIds: [f.people.lea] }))).status, 403);
  assert.match((await failure(saveActivityLeaders(admin, { leaderIds: ["fremd"] }))).message, /nicht \(mehr\) aktiv/);
  const assigned = await saveActivityLeaders(admin, { leaderIds: [f.people.lea, f.people.lea] });
  assert.deepEqual(
    assigned.leaders.map((person) => person.name),
    ["Lea Beispiel"],
  );
  assert.ok(assigned.staff.some((person) => person.name === "Anna Müller"));
  assert.match((await failure(createActivity(ctx, { ...base, title: " " }))).message, /bezeichnen/);
  assert.match((await failure(createActivity(ctx, { ...base, category: "Fernsehen" }))).message, /Kategorie/);
  assert.match((await failure(createActivity(ctx, { ...base, durationMinutes: 2 }))).message, /Dauer/);
  assert.match((await failure(createActivity(ctx, { ...base, repeatWeeks: 13 }))).message, /Wiederholung/);

  // Wöchentlich, drei Wochen: drei Termine im Abstand von sieben Tagen in derselben Serie.
  const { ids } = await createActivity(ctx, { ...base, repeatWeeks: 3 });
  assert.equal(ids.length, 3);
  const series = await q<{ series_id: string; starts_at: Date }>(
    `SELECT series_id, starts_at FROM carecore_activities WHERE id = ANY($1::uuid[]) ORDER BY starts_at`,
    [ids],
  );
  assert.equal(new Set(series.map((row) => row.series_id)).size, 1);
  assert.equal(series[1].starts_at.getTime() - series[0].starts_at.getTime(), 7 * 86_400_000);
  const past = ids[0];

  // Angebote für das ganze Haus erscheinen in jedem Wohnbereich, solche eines anderen Bereichs nicht.
  const { ids: house } = await createActivity(ctx, {
    ...base,
    title: "Gottesdienst",
    category: "Spiritualität",
    careUnitId: null,
  });
  await createActivity(ctx, { ...base, title: "Kochgruppe B", category: "Kochen & Backen", careUnitId: f.units.b });
  const week = await activityWeek(reader, zurichDay(at(-2)), f.units.a);
  assert.equal(week.canWrite, false);
  assert.deepEqual(
    week.activities
      .filter((item) => item.id === past || item.id === house[0])
      .map((item) => item.title)
      .sort(),
    ["Gottesdienst", "Singnachmittag"],
  );
  assert.ok(!week.activities.some((item) => item.title === "Kochgruppe B"));
  assert.deepEqual(week.leaders, ["Lea Beispiel"]);

  // Teilnahme: erst ab Beginn; nur Personen des Bereichs; jede Änderung im Protokoll der Akte.
  assert.match(
    (await failure(recordParticipation(ctx, ids[1], { entries: [{ residentId: erna, status: "participated" }] })))
      .message,
    /ab Beginn/,
  );
  const stranger = randomUUID();
  assert.equal(
    (await failure(recordParticipation(ctx, past, { entries: [{ residentId: stranger, status: "participated" }] })))
      .status,
    404,
  );
  assert.match(
    (await failure(recordParticipation(ctx, past, { entries: [{ residentId: erna, status: "schlief" }] }))).message,
    /ungültig/,
  );
  await recordParticipation(ctx, past, {
    entries: [
      { residentId: erna, status: "participated", note: "hat mitgesungen" },
      { residentId: otto, status: "declined" },
    ],
  });
  let detail = await activityDetail(ctx, past);
  assert.deepEqual(detail.activity.counts, { participated: 1, declined: 1, absent: 0 });
  assert.equal(detail.participants.find((person) => person.residentId === erna)?.note, "hat mitgesungen");
  // Unverändert gespeichert: keine neuen Einträge; Otto wieder auf „nicht erfasst“.
  const { changed } = await recordParticipation(ctx, past, {
    entries: [
      { residentId: erna, status: "participated", note: "hat mitgesungen" },
      { residentId: otto, status: null },
    ],
  });
  assert.equal(changed, 1);
  detail = await activityDetail(ctx, past);
  assert.deepEqual(detail.activity.counts, { participated: 1, declined: 0, absent: 0 });
  await recordParticipation(ctx, house[0], { entries: [{ residentId: erna, status: "participated" }] });

  const audit = await q<{ entity_type: string; action: string }>(
    `SELECT entity_type, action FROM carecore_audit_log WHERE after_data->>'residentId' = $1 AND entity_type = 'activity_participation'
     ORDER BY created_at`,
    [otto],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["recorded", "removed"],
  );

  // Bearbeiten und Absagen (mit Grund); abgesagte Angebote zählen nicht.
  await updateActivity(ctx, ids[2], { ...base, startsAt: at(14 * 24 + 1), location: "Garten" });
  // Zuteilung aufgehoben: bestehende Angebote behalten ihre Leitung, eine andere Person ist nicht wählbar.
  assert.equal((await failure(activityLeaderSettings(ctx))).status, 403);
  await saveActivityLeaders(admin, { leaderIds: [] });
  assert.deepEqual((await activityWeek(reader, zurichDay(at(-2)), f.units.a)).leaders, []);
  await updateActivity(ctx, ids[2], { ...base, startsAt: at(14 * 24 + 1), location: "Garten", leader: "Lea Beispiel" });
  assert.match(
    (await failure(updateActivity(ctx, ids[2], { ...base, startsAt: at(14 * 24 + 1), leader: "Max Meier" }))).message,
    /Leitung aus der Liste/,
  );
  await updateActivity(ctx, ids[2], { ...base, startsAt: at(14 * 24 + 1), location: "Garten", leader: "" });
  const leaderAudit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'setting' AND entity_id = $1 AND action = 'activity_leaders'`,
    [admin.actor.organizationId],
  );
  assert.equal(leaderAudit.length, 2);
  assert.match((await failure(cancelActivity(ctx, ids[1], { reason: "" }))).message, /Grund/);
  await cancelActivity(ctx, ids[1], { reason: "Leitung erkrankt" });
  assert.equal((await failure(cancelActivity(ctx, ids[1], { reason: "nochmals" }))).status, 409);
  assert.equal((await failure(updateActivity(ctx, ids[1], base))).status, 409);

  // Monatsübersicht: alle Personen des Bereichs, auch ohne Teilnahme.
  const report = await activityReport(reader, zurichDay(at(-2)).slice(0, 7), f.units.a);
  const byName = Object.fromEntries(report.residents.map((resident) => [resident.name, resident]));
  assert.deepEqual(byName["Erna Muster"].counts, { participated: 2, declined: 0, absent: 0 });
  assert.deepEqual(byName["Erna Muster"].byCategory, { "Musik & Singen": 1, Spiritualität: 1 });
  assert.deepEqual(byName["Otto Beispiel"].counts, { participated: 0, declined: 0, absent: 0 });
  assert.deepEqual(report.categories, ["Musik & Singen", "Spiritualität"]);

  // Portal: nur mit freigegebenem Bereich; teilgenommene Angebote ohne Bemerkung und kommende Angebote.
  const { id: account } = await createPortalAccount(admin, {
    kind: "relative",
    displayName: "Petra Muster",
    username: `petra-${randomUUID().slice(0, 8)}`,
  });
  const actor: PortalActor = {
    id: account,
    organizationId: admin.actor.organizationId,
    kind: "relative",
    displayName: "Petra Muster",
    mustChangePassword: false,
    userAgent: "test",
  };
  await createPortalGrant(admin, account, { residentId: erna, areas: ["reports"], basis: "consent" });
  assert.equal((await portalResidentDetail(admin.sql, actor, erna)).activities, undefined);
  await createPortalGrant(admin, account, { residentId: erna, areas: ["activities"], basis: "consent" });
  const portal = await portalResidentDetail(admin.sql, actor, erna);
  assert.deepEqual(portal.activities?.attended.map((item) => item.title).sort(), ["Gottesdienst", "Singnachmittag"]);
  assert.ok(!JSON.stringify(portal.activities).includes("mitgesungen"), "keine Bemerkungen der Pflege im Portal");
  assert.deepEqual(
    portal.activities?.upcoming.map((item) => item.title),
    [],
    "die abgesagte Woche erscheint nicht, die verschobene liegt ausserhalb von 14 Tagen",
  );
});
