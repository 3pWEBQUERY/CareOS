import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { changedFields, residentAudit } from "@/lib/resident-audit";
import { describeAudit, type ResidentAuditEntry } from "@/lib/resident-audit-labels";
import { recordSummary, recordTimeline, updateMasterData } from "@/lib/resident-record";
import { transferSheet } from "@/lib/resident-transfer";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

async function auditFor(org: string, residentId: string) {
  return q<{ entity_type: string; action: string; before_data: unknown; after_data: Record<string, unknown> }>(
    `SELECT entity_type, action, before_data, after_data FROM carecore_audit_log
     WHERE organization_id = $1 AND (entity_id = $2 OR COALESCE(after_data ->> 'residentId', before_data ->> 'residentId') = $2::text)
     ORDER BY created_at`,
    [org, residentId],
  );
}

test("Protokoll: Änderung und Protokolleintrag gelingen gemeinsam oder gar nicht", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const contactId = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`INSERT INTO carecore_resident_contacts (id, resident_id, full_name, phone) VALUES (${contactId}, ${residentId}, 'Peter Muster', '+41 79 000 00 00')`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "resident_contact",
      entityId: contactId,
      action: "created",
      after: { fullName: "Peter Muster", phone: "+41 79 000 00 00" },
    }),
  ]);
  // Scheitert die Änderung, entsteht auch kein Protokolleintrag.
  await assert.rejects(
    ctx.sql.transaction([
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "resident_contact",
        entityId: contactId,
        action: "updated",
      }),
      ctx.sql`INSERT INTO carecore_resident_contacts (id, resident_id, full_name) VALUES (${contactId}, ${residentId}, 'Doppelt')`,
    ]),
  );
  const rows = await auditFor(f.org, residentId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].after_data.residentId, residentId);
  assert.deepEqual(changedFields({ phone: "1", email: null }, { phone: "2", email: "" }), ["phone"]);
});

test("Protokoll: Stammdaten ohne AHV- und Versichertennummer im Klartext", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  await updateMasterData(ctx, residentId, {
    firstName: "Erna",
    lastName: "Muster",
    gender: "female",
    language: "de-CH",
    socialSecurityNumber: "756.1234.5678.97",
    insuranceNumber: "80756000001",
  });
  const [row] = (await auditFor(f.org, residentId)).filter((entry) => entry.action === "master_data_updated");
  assert.ok(row);
  assert.equal(row.after_data.socialSecurityNumber, "geändert");
  assert.equal(row.after_data.insuranceNumber, "geändert");
  assert.ok(!JSON.stringify(row).includes("756.1234.5678.97"));
});

test("Reanimationsstatus: Grundlage ist Pflicht, Änderungen werden eigens protokolliert", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const base = { firstName: "Erna", lastName: "Muster", gender: "female", language: "de-CH" };

  // Ohne Eintrag gilt der Status als nicht erfasst und fehlt in der Akte.
  let summary = await recordSummary(ctx, residentId);
  assert.equal(summary.master.resuscitationStatus, null);
  assert.ok(summary.missing.includes("Reanimationsstatus"));

  assert.equal(await status(updateMasterData(ctx, residentId, { ...base, resuscitationStatus: "dnr" })), 400);
  assert.equal(
    await status(
      updateMasterData(ctx, residentId, { ...base, resuscitationStatus: "vielleicht", resuscitationSource: "x" }),
    ),
    400,
  );
  assert.equal(
    await status(
      updateMasterData(ctx, residentId, {
        ...base,
        resuscitationStatus: "dnr",
        resuscitationSource: "Patientenverfügung",
        resuscitationDecidedOn: "2999-01-01",
      }),
    ),
    400,
  );

  await updateMasterData(ctx, residentId, {
    ...base,
    resuscitationStatus: "dnr",
    resuscitationSource: "Patientenverfügung",
    resuscitationDecidedOn: "2026-03-02",
  });
  summary = await recordSummary(ctx, residentId);
  assert.equal(summary.master.resuscitationStatus, "dnr");
  assert.equal(summary.master.resuscitationSource, "Patientenverfügung");
  assert.equal(summary.master.resuscitationDecidedOn, "2026-03-02");
  assert.ok(!summary.missing.includes("Reanimationsstatus"));
  assert.equal((await transferSheet(ctx, residentId)).master.resuscitationStatus, "dnr");

  // Unverändert gespeichert: kein weiterer Eintrag. Zurücksetzen leert auch Grundlage und Datum.
  await updateMasterData(ctx, residentId, {
    ...base,
    resuscitationStatus: "dnr",
    resuscitationSource: "Patientenverfügung",
    resuscitationDecidedOn: "2026-03-02",
  });
  await updateMasterData(ctx, residentId, { ...base, resuscitationStatus: "", resuscitationSource: "alt" });
  const [row] = await q<{ resuscitation_source: string | null; resuscitation_decided_on: string | null }>(
    "SELECT resuscitation_source, resuscitation_decided_on FROM carecore_residents WHERE id = $1",
    [residentId],
  );
  assert.equal(row.resuscitation_source, null);
  assert.equal(row.resuscitation_decided_on, null);

  const entries = (await auditFor(f.org, residentId)).filter((entry) => entry.action === "resuscitation_updated");
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].after_data, { status: "dnr", source: "Patientenverfügung", decidedOn: "2026-03-02" });
  assert.equal(entries[1].after_data.status, null);
  const described = describeAudit({
    id: "1",
    createdAt: "",
    actor: "Anna",
    entityType: "resident",
    action: "resuscitation_updated",
    before: null,
    after: entries[0].after_data,
  });
  assert.equal(described.title, "Reanimationsstatus geändert");
  assert.match(described.detail, /Keine Reanimation \(DNR\) · Grundlage: Patientenverfügung/);
});

test("Protokoll: lesbare Beschreibung der Einträge", () => {
  const entry = (patch: Partial<ResidentAuditEntry>): ResidentAuditEntry => ({
    id: "1",
    createdAt: "2026-09-28T10:00:00Z",
    actor: "Anna",
    entityType: "resident_contact",
    action: "updated",
    before: { fullName: "Peter", phone: "1", email: null },
    after: { fullName: "Peter", phone: "2", email: "" },
    ...patch,
  });
  assert.deepEqual(describeAudit(entry({})), {
    title: "Kontaktperson geändert",
    name: "Peter",
    detail: "Geändert: Telefon",
  });
  assert.equal(
    describeAudit(entry({ entityType: "resident_biography", before: null, after: { changedSections: ["lifeStory"] } }))
      .detail,
    "Abschnitte: Lebensgeschichte",
  );
  assert.equal(
    describeAudit(entry({ entityType: "unbekannt_typ", action: "x_y", before: null, after: null })).title,
    "Eintrag geändert",
  );
});

test("Überleitungsbogen: enthält die relevanten Angaben und wird protokolliert", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f, "Hans Beispiel");
  await q(
    `UPDATE carecore_residents SET medication_allergies = 'Penicillin', date_of_birth = '1938-04-02', gp_name = 'Dr. Weber' WHERE id = $1`,
    [residentId],
  );
  await q(
    `INSERT INTO carecore_resident_contacts (id, resident_id, full_name, relationship, phone, is_primary, is_emergency_contact)
     VALUES ($1, $2, 'Claudia Beispiel', 'Tochter', '+41 79 555 40 21', TRUE, TRUE)`,
    [randomUUID(), residentId],
  );
  await q(
    `INSERT INTO carecore_resident_clinical_flags (id, resident_id, category, label, severity) VALUES ($1, $2, 'Sturz', 'Erhöhtes Sturzrisiko', 'critical')`,
    [randomUUID(), residentId],
  );
  const med = randomUUID();
  await q(
    `INSERT INTO carecore_medications (id, organization_id, name, strength) VALUES ($1, $2, 'Metformin', '500 mg')`,
    [med, f.org],
  );
  await q(
    `INSERT INTO carecore_medication_orders (id, resident_id, medication_id, prescribed_by, dosage, schedule, status)
     VALUES ($1, $2, $3, 'Dr. Weber', '{"amount":"1 Tablette"}', '{"times":["08:00","20:00"],"weekdays":[]}', 'active'),
            ($4, $2, $3, 'Dr. Weber', '{"amount":"1 Tablette"}', '{"times":["12:00"],"weekdays":[]}', 'stopped')`,
    [randomUUID(), residentId, med, randomUUID()],
  );
  await q(
    `INSERT INTO carecore_vital_measurements (id, resident_id, metric, value, secondary_value, unit, status) VALUES ($1, $2, 'Blutdruck', 132, 78, 'mmHg', 'normal')`,
    [randomUUID(), residentId],
  );
  await q(
    `INSERT INTO carecore_body_observations (id, resident_id, kind, label, location, status, body_x, body_y, body_z) VALUES ($1, $2, 'wound', 'Hautriss', 'Unterarm links, aussen', 'Beobachten', 0.5, 1.9, 0)`,
    [randomUUID(), residentId],
  );

  const sheet = await transferSheet(ctx, residentId);
  assert.equal(sheet.master.lastName, "Beispiel");
  assert.deepEqual(sheet.allergies, ["Penicillin"]);
  assert.equal(sheet.contacts[0].name, "Claudia Beispiel");
  assert.ok(sheet.contacts[0].emergency);
  assert.equal(sheet.flags[0].label, "Erhöhtes Sturzrisiko");
  assert.equal(sheet.medication.length, 1, "abgesetzte Verordnungen erscheinen nicht");
  assert.deepEqual(sheet.medication[0].times, ["08:00", "20:00"]);
  assert.equal(sheet.vitals[0].secondaryValue, 78);
  assert.equal(sheet.bodyFindings[0].location, "Unterarm links, aussen");
  assert.equal(sheet.facility.unit, "Wohngruppe A");
  const transfers = (await auditFor(f.org, residentId)).filter((entry) => entry.entity_type === "resident_transfer");
  assert.equal(transfers.length, 1);

  // Akten anderer Organisationen sind nicht erreichbar.
  const other = await fixture();
  assert.equal(await status(transferSheet(await apiContextFor(other, "anna"), residentId)), 404);
});

test("Verlauf: Dokumentation der Kategorie Medikation erscheint unter dem Filter Medikation", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  await q(
    `INSERT INTO carecore_documentation_entries (id, resident_id, author_user_id, category, body) VALUES
       ($1, $3, $4, 'Medikation', 'Neue Dosierung besprochen'), ($2, $3, $4, 'Mobilität', 'Mit Rollator unterwegs')`,
    [randomUUID(), randomUUID(), residentId, f.people.anna],
  );
  const timeline = await recordTimeline(ctx, residentId);
  const byBody = Object.fromEntries(timeline.map((entry) => [entry.description, entry.category]));
  assert.equal(byBody["Neue Dosierung besprochen"], "Medikation");
  assert.equal(byBody["Mit Rollator unterwegs"], "Pflege");
});
