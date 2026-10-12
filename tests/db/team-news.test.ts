import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { channelAction, createChannel, createPost, markAllRead, postAction, teamNews } from "@/lib/team-news";
import { apiContextFor, fixture, q } from "../support/db";

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );
const news = (ctx: Awaited<ReturnType<typeof apiContextFor>>, channelId?: string) =>
  teamNews(ctx, new URLSearchParams(channelId ? { channelId } : {}));

test("Teamkanäle: Hauskanal, eigene Kanäle mit Wohnbereich, Beitreten, Schreibrechte und Archivieren", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const anna = await apiContextFor(f, "anna");
  const ben = await apiContextFor(f, "ben");

  // Der Hauskanal entsteht von selbst; dort schreibt nur die Leitung.
  const first = await news(anna);
  const house = first.channels.find((channel) => channel.isDefault)!;
  assert.equal(house.name, "Haus");
  assert.equal(house.canPost, false);
  assert.equal(first.canManage, false);
  assert.equal(await status(createPost(anna, { channelId: house.id, title: "Hallo", body: "Test" })), 403);
  assert.equal((await news(lead)).channels.find((channel) => channel.isDefault)?.canPost, true);

  // Kanäle legt nur die Leitung an; ein Wohnbereichskanal startet mit den Personen des Bereichs.
  assert.equal(await status(createChannel(anna, { name: "Eigener Kanal" })), 403);
  const unit = await createChannel(lead, { name: "Wohngruppe A", color: "green", careUnitId: f.units.a });
  assert.equal(await status(createChannel(lead, { name: "wohngruppe a" })), 409);
  assert.equal(await status(createChannel(lead, { name: "X" })), 400);
  const annaChannels = (await news(anna)).channels;
  assert.equal(annaChannels.find((channel) => channel.id === unit)?.joined, true);
  assert.equal(annaChannels.find((channel) => channel.id === unit)?.color, "green");
  // Ben arbeitet in Bereich B: nicht Mitglied, darf nicht schreiben, kann beitreten und wieder gehen.
  const benUnit = (await news(ben)).channels.find((channel) => channel.id === unit)!;
  assert.deepEqual([benUnit.joined, benUnit.canPost], [false, false]);
  assert.equal(await status(createPost(ben, { channelId: unit, title: "Frage", body: "Darf ich?" })), 403);
  await channelAction(ben, unit, { action: "join" });
  assert.equal((await news(ben)).channels.find((channel) => channel.id === unit)?.canPost, true);
  await channelAction(ben, unit, { action: "leave" });
  assert.equal((await news(ben)).channels.find((channel) => channel.id === unit)?.joined, false);
  // Den Hauskanal kann niemand verlassen.
  assert.equal(await status(channelAction(anna, house.id, { action: "leave" })), 409);

  // Archivieren nur durch die Leitung; danach verschwindet der Kanal.
  assert.equal(await status(channelAction(anna, unit, { action: "archive" })), 403);
  await channelAction(lead, unit, { action: "archive" });
  assert.equal(
    (await news(anna)).channels.some((channel) => channel.id === unit),
    false,
  );
  const [audit] = await q<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM carecore_audit_log WHERE entity_type = 'team_channel' AND entity_id = $1`,
    [unit],
  );
  assert.equal(audit.count, 2);
});

test("Teamkanäle: Beiträge, Lesebestätigung, dringende Meldung, Bearbeiten, Anheften und Archivieren", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const anna = await apiContextFor(f, "anna");
  const max = await apiContextFor(f, "max");
  const house = (await news(lead)).channels.find((channel) => channel.isDefault)!;

  // Eingaben werden geprüft.
  assert.equal(await status(createPost(lead, { channelId: house.id, title: "Hi", body: "Zu kurz" })), 400);
  assert.equal(await status(createPost(lead, { channelId: house.id, title: "Titel ok", body: "" })), 400);

  const urgent = await createPost(lead, {
    channelId: house.id,
    title: "Neue Hygienevorgabe",
    body: "Ab Montag gilt die neue Händedesinfektion.",
    importance: "critical",
    requiresAck: true,
    pinned: true,
  });
  // Dringend mit Lesebestätigung: alle anderen aktiven Personen erhalten eine Benachrichtigung, die Leitung nicht.
  const notified = await q<{ user_id: string }>(
    `SELECT user_id FROM carecore_notifications WHERE type = 'team_post' AND link_url LIKE $1`,
    [`%post=${urgent}`],
  );
  assert.equal(notified.length, Object.keys(f.people).length - 1);
  assert.equal(
    notified.some((row) => row.user_id === f.people.leadA),
    false,
  );

  const seen = await news(anna);
  const post = seen.posts.find((item) => item.id === urgent)!;
  assert.deepEqual(
    [post.pinned, post.requiresAck, post.readAt, post.isOwn, post.canEdit],
    [true, true, null, false, false],
  );
  assert.equal(seen.stats.unread, 1);

  // Lesen und Bestätigen; die Bestätigung wird nur einmal protokolliert.
  await postAction(anna, urgent, { action: "read" });
  await postAction(anna, urgent, { action: "ack" });
  await postAction(anna, urgent, { action: "ack" });
  const after = (await news(lead)).posts.find((item) => item.id === urgent)!;
  // Gezählt werden die Leitung (eigener Beitrag) und Anna.
  assert.deepEqual([after.readCount, after.ackCount], [2, 2]);
  const acks = await q<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM carecore_audit_log WHERE entity_type = 'team_post' AND entity_id = $1 AND action = 'acknowledged'`,
    [urgent],
  );
  assert.equal(acks[0].count, 1);

  // Alles gelesen markieren.
  await createPost(lead, { channelId: house.id, title: "Zweiter Beitrag", body: "Noch eine Info für alle." });
  assert.equal((await news(max)).stats.unread, 2);
  assert.equal(await markAllRead(max, {}), 2);
  assert.equal((await news(max)).stats.unread, 0);

  // Bearbeiten nur durch die verfassende Person, Anheften nur durch die Leitung, Archivieren mit Grund.
  assert.equal(await status(postAction(anna, urgent, { action: "edit", title: "Geändert", body: "Neu" })), 403);
  await postAction(lead, urgent, {
    action: "edit",
    title: "Neue Hygienevorgabe (ergänzt)",
    body: "Ab Montag gilt sie.",
  });
  assert.ok((await news(anna)).posts.find((item) => item.id === urgent)?.editedAt);
  assert.equal(await status(postAction(anna, urgent, { action: "unpin" })), 403);
  await postAction(lead, urgent, { action: "unpin" });
  assert.equal(await status(postAction(lead, urgent, { action: "archive" })), 400);
  await postAction(lead, urgent, { action: "archive", reason: "Ersetzt durch neue Weisung" });
  assert.equal(
    (await news(anna)).posts.some((item) => item.id === urgent),
    false,
  );
  assert.equal(await status(postAction(anna, urgent, { action: "read" })), 404);
  assert.equal(await status(postAction(anna, urgent, { action: "unbekannt" })), 404);
});
