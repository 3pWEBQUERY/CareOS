import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { verifyPassword } from "@/lib/auth";
import {
  completePasswordLink,
  describePasswordLink,
  hashLinkToken,
  requestPasswordReset,
  sendPasswordLink,
} from "@/lib/password-links";
import { fixture, q } from "../support/db";
import { startMockSmtp } from "../support/mock-smtp.mjs";

// E-Mail-Versand gegen den Test-Mailserver; Links zeigen auf eine feste Adresse, nie auf den Host der Anfrage.
const smtp = await startMockSmtp(0);
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = String(smtp.port);
process.env.MAIL_FROM = "CareOS <noreply@carecore.test>";
process.env.APP_URL = "https://carecore.test";
after(() => smtp.close());

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );
const tokenOf = (body: string) => /\/passwort\?token=([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? "";
const mailsTo = (email: string) => smtp.messages.filter((message) => message.to.includes(email));

async function withEmail(person: string, f: Awaited<ReturnType<typeof fixture>>) {
  const email = `${person}-${randomUUID().slice(0, 8)}@heim.test`;
  await q(`UPDATE carecore_user_profiles SET email = $1 WHERE user_id = $2`, [email, f.people[person]]);
  const [user] = await q<{ username: string }>(`SELECT username FROM carecore_users WHERE id = $1`, [f.people[person]]);
  return { email, username: user.username };
}

test("Passwort vergessen: Link per E-Mail, einmal einlösbar, Sitzungen enden, protokolliert", async () => {
  const f = await fixture();
  const { email, username } = await withEmail("anna", f);
  await q(
    `INSERT INTO carecore_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')`,
    [randomUUID(), f.people.anna, randomUUID().replace(/-/g, "")],
  );

  // Ohne hinterlegte Adresse geht keine E-Mail hinaus; die Antwort verrät das nicht (kein Fehler).
  const [max] = await q<{ username: string }>(`SELECT username FROM carecore_users WHERE id = $1`, [f.people.max]);
  const before = smtp.messages.length;
  await requestPasswordReset(max.username);
  await requestPasswordReset("gibt-es-nicht@heim.test");
  assert.equal(smtp.messages.length, before);

  // Über die E-Mail-Adresse (Gross-/Kleinschreibung egal).
  await requestPasswordReset(email.toUpperCase());
  const [mail] = mailsTo(email);
  assert.ok(mail, "E-Mail versendet");
  assert.match(mail.subject, /Passwort neu setzen/);
  assert.match(mail.body, /https:\/\/carecore\.test\/passwort\?token=/);
  const token = tokenOf(mail.body);
  assert.deepEqual(await describePasswordLink(token), { username, purpose: "reset" });
  // Gespeichert ist nur der Hash.
  const stored = await q(`SELECT 1 FROM carecore_password_links WHERE token_hash = $1`, [hashLinkToken(token)]);
  assert.equal(stored.length, 1);
  assert.equal((await q(`SELECT 1 FROM carecore_password_links WHERE token_hash = $1`, [token])).length, 0);

  assert.equal(await status(completePasswordLink(token, "kurz")), 400);
  assert.deepEqual(await completePasswordLink(token, "Neues-Passwort-2026"), { username });
  const [user] = await q<{ password_hash: string }>(`SELECT password_hash FROM carecore_users WHERE id = $1`, [
    f.people.anna,
  ]);
  assert.equal(await verifyPassword("Neues-Passwort-2026", user.password_hash), true);
  assert.equal((await q(`SELECT 1 FROM carecore_sessions WHERE user_id = $1`, [f.people.anna])).length, 0);
  const actions = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_id = $1 AND entity_type = 'user' ORDER BY created_at`,
    [f.people.anna],
  );
  assert.deepEqual(
    actions.map((row) => row.action),
    ["password_reset_requested", "password_set_by_link"],
  );

  // Ein zweites Mal geht nicht, auch nicht gleichzeitig.
  assert.equal(await status(completePasswordLink(token, "Noch-ein-Passwort-2026")), 410);
  assert.equal(await describePasswordLink(token), null);
});

test("Passwort vergessen: neuer Link ersetzt den alten, abgelaufen ungültig, höchstens 3 je Stunde", async () => {
  const f = await fixture();
  const { email, username } = await withEmail("max", f);
  await requestPasswordReset(username);
  await requestPasswordReset(username);
  const [first, second] = mailsTo(email).map((mail) => tokenOf(mail.body));
  assert.equal(await describePasswordLink(first), null, "älterer Link ist ungültig");
  assert.ok(await describePasswordLink(second));

  // Abgelaufen.
  await q(`UPDATE carecore_password_links SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1`, [
    hashLinkToken(second),
  ]);
  assert.equal(await status(completePasswordLink(second, "Neues-Passwort-2026")), 410);

  // Drittes Mal noch, viertes Mal nicht mehr (in derselben Stunde).
  await requestPasswordReset(username);
  await requestPasswordReset(username);
  assert.equal(mailsTo(email).length, 3);

  // Gesperrte Konten bekommen keinen Link.
  const lea = await withEmail("lea", f);
  await q(`UPDATE carecore_users SET active = FALSE WHERE id = $1`, [f.people.lea]);
  await requestPasswordReset(lea.username);
  assert.equal(mailsTo(lea.email).length, 0);
});

test("Administration: Link an Mitarbeitende senden, nur in der eigenen Organisation und mit E-Mail-Adresse", async () => {
  const f = await fixture();
  const other = await fixture();
  const admin = { id: f.people.leadA };
  const { email } = await withEmail("ben", f);
  const result = await sendPasswordLink(admin, f.people.ben);
  assert.deepEqual(result, { email });
  const [mail] = mailsTo(email);
  assert.match(mail.subject, /Zugang einrichten/);
  assert.deepEqual(await describePasswordLink(tokenOf(mail.body)), {
    username: (await q<{ username: string }>(`SELECT username FROM carecore_users WHERE id = $1`, [f.people.ben]))[0]
      .username,
    purpose: "invite",
  });
  // Ohne Adresse, fremde Organisation.
  assert.equal(await status(sendPasswordLink(admin, f.people.sam)), 400);
  assert.equal(await status(sendPasswordLink(admin, other.people.anna)), 404);
  const [audit] = await q<{ actor_user_id: string }>(
    `SELECT actor_user_id FROM carecore_audit_log WHERE entity_id = $1 AND action = 'password_link_sent'`,
    [f.people.ben],
  );
  assert.equal(audit.actor_user_id, f.people.leadA);
});
