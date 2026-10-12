import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import {
  addMembers,
  chatPayload,
  createConversation,
  deleteMessage,
  editMessage,
  pinMessage,
  reactionsFor,
  removeMember,
  renameConversation,
  sendMessage,
  toggleReaction,
  updateMembership,
  uploadChatFile,
} from "@/lib/messenger";
import { readableFile } from "@/lib/file-access";
import { liveSnapshot } from "@/lib/live-events";
import type { CarecoreActor } from "@/lib/server-data";
import { apiContextFor, fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

async function conversation(org: string, kind: "direct" | "group", members: string[], title: string | null = null) {
  const id = randomUUID();
  await q(
    `INSERT INTO carecore_conversations (id, organization_id, title, kind, created_by) VALUES ($1, $2, $3, $4, $5)`,
    [id, org, title, kind, members[0]],
  );
  for (const userId of members)
    await q(`INSERT INTO carecore_conversation_members (conversation_id, user_id) VALUES ($1, $2)`, [id, userId]);
  return id;
}

const notificationsFor = (userId: string) =>
  q<{ type: string; priority: string; title: string; body: string }>(
    "SELECT type, priority, title, body FROM carecore_notifications WHERE user_id = $1 AND type LIKE 'message_%' ORDER BY created_at, title",
    [userId],
  );

test("Messenger: Gruppe benachrichtigt nur Erwähnte, Direktnachricht die andere Person", async () => {
  const f = await fixture();
  const anna = await apiContextFor(f, "anna");
  const group = await conversation(f.org, "group", [f.people.anna, f.people.max, f.people.lea], "Frühdienst");
  const sent = await sendMessage(anna, group, "@Max Meier bitte Zimmer 12 übernehmen");
  assert.deepEqual(sent.mentions, [f.people.max]);
  const [maxNote] = await notificationsFor(f.people.max);
  assert.equal(maxNote.type, "message_mention");
  assert.equal(maxNote.priority, "high");
  assert.equal(maxNote.title, "Anna Müller hat dich erwähnt");
  assert.equal(maxNote.body, "Frühdienst: @Max Meier bitte Zimmer 12 übernehmen");
  assert.equal((await notificationsFor(f.people.lea)).length, 0);

  const direct = await conversation(f.org, "direct", [f.people.anna, f.people.lea]);
  await sendMessage(anna, direct, "Danke dir!");
  const [leaNote] = await notificationsFor(f.people.lea);
  assert.equal(leaNote.type, "message_direct");
  assert.equal(leaNote.title, "Nachricht von Anna Müller");

  // Nicht-Mitglieder erreichen die Unterhaltung nicht; leere Nachrichten werden abgewiesen.
  assert.equal(await status(sendMessage(await apiContextFor(f, "ben"), group, "Hallo")), 403);
  assert.equal(await status(sendMessage(anna, group, "   ")), 400);
});

test("Messenger: Reaktion setzen und wieder entfernen, nur aus der festen Auswahl", async () => {
  const f = await fixture();
  const anna = await apiContextFor(f, "anna");
  const max = await apiContextFor(f, "max");
  const group = await conversation(f.org, "group", [f.people.anna, f.people.max], "Team");
  const { id } = await sendMessage(anna, group, "Übergabe ist fertig");

  assert.deepEqual(await toggleReaction(max, id, "👍"), { active: true });
  await toggleReaction(anna, id, "👍");
  await toggleReaction(anna, id, "✅");
  const [thumbs, check] = (await reactionsFor(max, [id])).get(id) ?? [];
  assert.equal(thumbs.emoji, "👍");
  assert.equal(thumbs.count, 2);
  assert.equal(thumbs.mine, true);
  assert.deepEqual(thumbs.names, ["Max Meier", "Anna Müller"]);
  assert.equal(check.mine, false);

  assert.deepEqual(await toggleReaction(max, id, "👍"), { active: false });
  const [after] = (await reactionsFor(max, [id])).get(id) ?? [];
  assert.equal(after.count, 1);
  assert.equal(after.mine, false);

  assert.equal(await status(toggleReaction(max, id, "🔥")), 400);
  assert.equal(await status(toggleReaction(await apiContextFor(f, "ben"), id, "👍")), 403);
});

test("Messenger: Antworten, Dateien, Bearbeiten, Löschen, Anheften und gelesen", async () => {
  const f = await fixture();
  const anna = await apiContextFor(f, "anna");
  const max = await apiContextFor(f, "max");
  const group = await conversation(f.org, "group", [f.people.anna, f.people.max, f.people.lea], "Frühdienst");
  const { id: first } = await sendMessage(anna, group, "Wer übernimmt Zimmer 12?");
  const { id: reply } = await sendMessage(max, group, "Ich", { replyToId: first, priority: "important" });

  // Datei vom Gerät (gehört zur Unterhaltung) und aus der gemeinsamen Ablage (verknüpft).
  const uploaded = await uploadChatFile(anna, group, new File(["Plan"], "Plan.txt", { type: "text/plain" }));
  const shared = randomUUID();
  await q(
    `INSERT INTO carecore_cloud_files (id, organization_id, name, mime_type, size_bytes, content_base64, uploaded_by, purpose)
     VALUES ($1, $2, 'Standard.pdf', 'application/pdf', 3, 'YWJj', $3, 'shared')`,
    [shared, f.org, f.people.lea],
  );
  await sendMessage(anna, group, "", { attachmentIds: [uploaded.id, shared] });
  assert.equal(await status(sendMessage(max, group, "fremd", { attachmentIds: [randomUUID()] })), 404);

  const payload = await chatPayload(max, group);
  const messages = payload.conversation!.messages;
  const answered = messages.find((message) => message.id === reply)!;
  assert.equal(answered.replyTo?.body, "Wer übernimmt Zimmer 12?");
  assert.equal(answered.priority, "important");
  const files = messages.at(-1)!.attachments;
  assert.deepEqual(
    files.map((file) => [file.name, file.source]),
    [
      ["Plan.txt", "chat"],
      ["Standard.pdf", "shared"],
    ],
  );
  assert.equal(payload.conversation!.files.length, 2);
  // Chat-Dateien lesen nur Mitglieder.
  const benActor = (await apiContextFor(f, "ben")).actor as unknown as CarecoreActor;
  const maxActor = max.actor as unknown as CarecoreActor;
  assert.ok(await readableFile(maxActor, uploaded.id));
  assert.equal(await readableFile(benActor, uploaded.id), null);

  // Bearbeiten und löschen nur eigene Nachrichten; gelöschte zeigen keinen Inhalt mehr.
  assert.equal(await status(editMessage(max, first, "geändert")), 403);
  await editMessage(anna, first, "Wer übernimmt Zimmer 14?");
  // Echtzeit: Anheften, Reaktionen und Löschen ändern den Stand für alle Mitglieder.
  const before = (await liveSnapshot(anna)).messages;
  await pinMessage(max, first, true);
  const pinned = (await liveSnapshot(anna)).messages;
  assert.notEqual(pinned, before);
  await toggleReaction(max, first, "✅");
  assert.notEqual((await liveSnapshot(anna)).messages, pinned);
  await deleteMessage(max, reply);
  const after = (await chatPayload(anna, group)).conversation!.messages;
  const edited = after.find((message) => message.id === first)!;
  assert.equal(edited.body, "Wer übernimmt Zimmer 14?");
  assert.ok(edited.editedAt);
  assert.equal(edited.pinnedByName, "Max Meier");
  const deleted = after.find((message) => message.id === reply)!;
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.body, "");
  assert.equal(await status(toggleReaction(anna, reply, "👍")), 409);

  // Gelesen: Max hat die Unterhaltung zuletzt geöffnet.
  const maxMember = (await chatPayload(anna, group)).conversation!.members.find(
    (member) => member.userId === f.people.max,
  )!;
  assert.ok(maxMember.lastReadAt);
});

test("Messenger: @alle, dringend, stummgeschaltet, Direktnachricht wiederverwenden und Gruppe verwalten", async () => {
  const f = await fixture();
  const anna = await apiContextFor(f, "anna");
  const max = await apiContextFor(f, "max");
  const lea = await apiContextFor(f, "lea");
  const { id: group } = await createConversation(anna, {
    kind: "group",
    title: "Wohnbereich A",
    memberIds: [f.people.max, f.people.lea],
  });

  await sendMessage(anna, group, "@alle Teamsitzung um 14 Uhr");
  assert.equal((await notificationsFor(f.people.max)).at(-1)?.type, "message_mention");
  assert.equal((await notificationsFor(f.people.lea)).at(-1)?.type, "message_mention");

  // Stummgeschaltet: Direktnachrichten ohne Hinweis, dringende trotzdem.
  const { id: direct } = await createConversation(anna, { kind: "direct", memberIds: [f.people.max] });
  const again = await createConversation(max, { kind: "direct", memberIds: [f.people.anna] });
  assert.equal(again.id, direct, "bestehende Direktnachricht wird geöffnet");
  assert.equal(again.existing, true);
  await updateMembership(max, direct, { muted: true });
  const before = (await notificationsFor(f.people.max)).length;
  await sendMessage(anna, direct, "Kurze Frage");
  assert.equal((await notificationsFor(f.people.max)).length, before);
  await sendMessage(anna, direct, "Bitte sofort in Zimmer 3", { priority: "urgent" });
  const urgent = (await notificationsFor(f.people.max)).at(-1)!;
  assert.equal(urgent.type, "message_urgent");
  assert.equal(urgent.priority, "high");

  // Als ungelesen markieren und Anheften der Unterhaltung.
  await chatPayload(max, direct);
  await updateMembership(max, direct, { unread: true, pinned: true });
  const summary = (await chatPayload(max, null)).conversations.find((item) => item.id === direct)!;
  assert.equal(summary.unreadCount, 1);
  assert.equal(summary.pinned, true);

  // Gruppe: umbenennen, Personen hinzufügen (jedes Mitglied), entfernen (nur wer erstellt hat), verlassen.
  await renameConversation(max, group, "Wohnbereich A – Spätdienst");
  await addMembers(lea, group, [f.people.sam]);
  assert.equal(await status(removeMember(max, group, f.people.lea)), 403);
  await removeMember(anna, group, f.people.sam);
  await removeMember(lea, group, f.people.lea);
  assert.equal(await status(sendMessage(lea, group, "noch da?")), 403);
  const system = (await chatPayload(anna, group)).conversation!.messages.filter((message) => message.kind === "system");
  assert.deepEqual(
    system.map((message) => message.body),
    [
      "Anna Müller hat die Gruppe „Wohnbereich A“ erstellt.",
      "Max Meier hat die Gruppe in „Wohnbereich A – Spätdienst“ umbenannt.",
      "Lea Beispiel hat Sam Springer hinzugefügt.",
      "Anna Müller hat Sam Springer entfernt.",
      "Lea Beispiel hat die Gruppe verlassen.",
    ],
  );
  assert.equal(await status(renameConversation(anna, direct, "x")), 400);
});
