import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { verifyPassword } from "@/lib/auth";
import { commitImport, previewImport } from "@/lib/data-import";
import { apiContextFor, fixture, q } from "../support/db";
import { startMockSmtp } from "../support/mock-smtp.mjs";

const smtp = await startMockSmtp(0);
after(() => smtp.close());

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

async function setup() {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  };
  return { f, lead, admin };
}

test("Datenübernahme Bewohner: Prüfung je Zeile, nur vollständig gültige Dateien, eine Transaktion, Protokoll", async () => {
  const { f, lead, admin } = await setup();
  const tag = randomUUID().slice(0, 6);
  const bad = [
    "Vorname;Nachname;Geburtsdatum (TT.MM.JJJJ);Geschlecht;Wohnbereich;Zimmer;Eintritt;Status;Notiz",
    `Erika${tag};Muster;12.03.1938;weiblich;Wohngruppe A;101;01.09.2026;aktiv;Allergie: Penicillin`,
    `Hans${tag};Beispiel;31.02.1940;männlich;Wohngruppe Z;102;01.09.2026;;`,
    `Erika${tag};Muster;12.03.1938;weiblich;Wohngruppe A;103;01.09.2026;geplant;`,
    `;Ohne;01.01.1930;x;Wohngruppe B;;2026-09-01;später;`,
  ].join("\n");
  assert.equal(await status(previewImport(lead, "residents", bad)), 403);
  const preview = await previewImport(admin, "residents", bad);
  assert.equal(preview.valid, 1);
  assert.equal(preview.invalid, 3);
  assert.deepEqual(
    preview.rows.map((row) => row.errors),
    [
      [],
      ["Geburtsdatum ungültig (TT.MM.JJJJ)", "Wohnbereich „Wohngruppe Z“ gibt es nicht"],
      ["Steht doppelt in der Datei"],
      [
        "Vorname fehlt",
        "Zimmer fehlt",
        "Geschlecht: weiblich, männlich, divers oder leer",
        "Status: aktiv, geplant oder leer",
      ],
    ],
  );
  // Mit Fehlern wird nichts übernommen.
  assert.equal(await status(commitImport(admin, "residents", bad)), 400);
  assert.equal(await status(previewImport(admin, "residents", "Vorname;Nachname\nA;B")), 400, "Spalten fehlen");

  const good = [
    "Vorname;Nachname;Geburtsdatum;Geschlecht;Wohnbereich;Zimmer;Eintritt;Status;Notiz",
    `Erika${tag};Muster;12.03.1938;weiblich;wohngruppe a;101;01.09.2026;aktiv;Allergie: Penicillin`,
    `Hans${tag};Beispiel;1940-02-28;;Wohngruppe B;B 7;01.10.2026;geplant;`,
  ].join("\r\n");
  assert.deepEqual(await commitImport(admin, "residents", good), { created: 2, invited: 0, startPasswords: [] });
  const residents = await q<{ first_name: string; status: string; gender: string; unit: string; room: string }>(
    `SELECT r.first_name, r.status, r.gender, cu.name AS unit, ro.name AS room FROM carecore_residents r
     JOIN carecore_resident_stays s ON s.resident_id = r.id JOIN carecore_care_units cu ON cu.id = s.care_unit_id
     JOIN carecore_rooms ro ON ro.id = s.room_id WHERE r.organization_id = $1 AND r.first_name LIKE $2 ORDER BY r.first_name`,
    [f.org, `%${tag}`],
  );
  assert.deepEqual(residents, [
    { first_name: `Erika${tag}`, status: "active", gender: "female", unit: "Wohngruppe A", room: "101" },
    { first_name: `Hans${tag}`, status: "planned", gender: "unspecified", unit: "Wohngruppe B", room: "B 7" },
  ]);
  const audit = await q(`SELECT 1 FROM carecore_audit_log WHERE organization_id = $1 AND action = 'imported'`, [f.org]);
  assert.equal(audit.length, 2);
  // Ein zweites Mal: bereits erfasst.
  const again = await previewImport(admin, "residents", good);
  assert.deepEqual(
    again.rows.map((row) => row.errors),
    [["Ist bereits in CareOS erfasst"], ["Ist bereits in CareOS erfasst"]],
  );
});

test("Datenübernahme Mitarbeitende: Rollen per Name, Einladung mit E-Mail, sonst einmaliges Startpasswort", async () => {
  const { f, admin } = await setup();
  const tag = randomUUID().slice(0, 6);
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(smtp.port);
  process.env.MAIL_FROM = "CareOS <noreply@carecore.test>";
  process.env.APP_URL = "https://carecore.test";
  const csv = [
    "Name,Benutzername,Rolle,Funktion,Telefon,E-Mail,Wohnbereich",
    `Nora Neu,nora.${tag},Pflege,FaGe,,nora.${tag}@heim.test,Wohngruppe A`,
    `Otto Ohne,otto.${tag},pflege,,,,`,
  ].join("\n");
  const preview = await previewImport(admin, "staff", csv);
  assert.equal(preview.invalid, 0, JSON.stringify(preview.rows.map((row) => row.errors)));

  const wrong = await previewImport(
    admin,
    "staff",
    ["Name;Benutzername;Rolle;E-Mail", `X;nora ${tag};Chef;kaputt`, `Y;otto.${tag};pflege;`].join("\n"),
  );
  assert.deepEqual(wrong.rows[0].errors, [
    "Benutzername ohne Leerzeichen",
    "Rolle „Chef“ gibt es nicht",
    "E-Mail-Adresse ungültig",
  ]);

  const result = await commitImport(admin, "staff", csv);
  assert.equal(result.created, 2);
  assert.equal(result.invited, 1);
  assert.deepEqual(
    result.startPasswords.map((entry) => entry.username),
    [`otto.${tag}`],
  );
  const [otto] = await q<{ password_hash: string; organization_id: string }>(
    `SELECT u.password_hash, p.organization_id FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
     WHERE u.username = $1`,
    [`otto.${tag}`],
  );
  assert.equal(otto.organization_id, f.org);
  assert.equal(await verifyPassword(result.startPasswords[0].password, otto.password_hash), true);
  assert.equal(smtp.messages.filter((message) => message.to.includes(`nora.${tag}@heim.test`)).length, 1);
  // Jetzt vergeben.
  const again = await previewImport(admin, "staff", csv);
  assert.ok(again.rows.every((row) => row.errors.includes("Benutzername ist bereits vergeben")));
});
