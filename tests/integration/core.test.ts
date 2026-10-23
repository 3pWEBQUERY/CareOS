/**
 * Integrationstests der Kernabläufe gegen Postgres (PRD §66): Bereichs-Scope, Aufgabenerzeugung über mehrere
 * «Instanzen», Rückstandsregel, Abwesenheit/Rückkehr/Verlegung. Ohne DATABASE_URL übersprungen (siehe fixture.ts).
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createFixture, ctxFor, dbOpts, dropFixture, type Fixture } from './fixture'

describe('Kernabläufe (Postgres)', dbOpts, () => {
  let f: Fixture
  before(async () => { f = await createFixture() })
  after(async () => {
    if (f) await dropFixture(f)
    const { db } = await import('../../src/lib/db')
    await db.$disconnect()
  })

  test('Berechtigung: Pflege sieht nur Personen des eigenen Bereichs', async () => {
    const { residentInScope } = await import('../../src/lib/context')
    const ctx = await ctxFor(f, f.nurseA.id)
    assert.deepEqual(ctx.unitIds, [f.unitA.id])
    assert.ok(await residentInScope(ctx, f.resA.id))
    assert.equal(await residentInScope(ctx, f.resB.id), null)
    assert.equal(ctx.can('resident.read', { unitId: f.unitB.id, locationId: f.loc.id }), false)
    // Stationsleitung mit Standort-Rolle sieht beide Bereiche
    const lead = await ctxFor(f, f.lead.id)
    assert.equal(lead.unitIds.length, 2)
    assert.ok(await residentInScope(lead, f.resB.id))
  })

  test('Aufgabenerzeugung: gleichzeitig ohne Duplikate, Invalidierung wirkt über den gemeinsamen Merker', async () => {
    const { ensureTasksForDay, invalidateTaskGeneration } = await import('../../src/lib/tasks')
    const { addDays, startOfDay, dbDate } = await import('../../src/lib/time')
    const day = addDays(startOfDay(new Date()), 1)
    await f.db.intervention.create({ data: { residentId: f.resA.id, title: 'Lagerung', category: 'Grundpflege', times: ['08:00', '12:00'], weekdays: [] } })
    // Vier gleichzeitige Aufrufe (wie mehrere Instanzen nach Ablauf des Merkers)
    await Promise.all([1, 2, 3, 4].map(() => ensureTasksForDay(f.unitA.id, day)))
    const count = () => f.db.task.count({ where: { unitId: f.unitA.id, dueAt: { gte: day, lt: addDays(day, 1) } } })
    assert.equal(await count(), 2)
    assert.ok(await f.db.taskGeneration.findUnique({ where: { unitId_day: { unitId: f.unitA.id, day: dbDate(day) } } }))
    // Neue Massnahme: ohne Invalidierung bleibt der Merker frisch …
    await f.db.intervention.create({ data: { residentId: f.resA.id, title: 'Mundpflege', category: 'Grundpflege', times: ['09:00'], weekdays: [] } })
    await ensureTasksForDay(f.unitA.id, day)
    assert.equal(await count(), 2)
    // … nach der Invalidierung (andere Instanz: Merker in Postgres gelöscht) entsteht die Aufgabe
    await invalidateTaskGeneration(f.unitA.id)
    assert.equal(await f.db.taskGeneration.count({ where: { unitId: f.unitA.id } }), 0)
    await ensureTasksForDay(f.unitA.id, day)
    assert.equal(await count(), 3)
  })

  test('Rückstand: eine Zahl für überfällig, Routine früherer Schichten wird übergeben', async () => {
    const { overdueCount, expireBacklog } = await import('../../src/lib/tasks')
    const now = new Date()
    const base = { orgId: f.org.id, unitId: f.unitA.id, residentId: f.resA.id, category: 'Grundpflege' }
    const twoDays = new Date(now.getTime() - 2 * 864e5)
    const [slotOld, manualOld, escalatedNow] = await Promise.all([
      f.db.task.create({ data: { ...base, title: 'Routine alt', dueAt: twoDays, source: 'careplan', sourceId: 'it-' + f.tag + '-1', status: 'escalated' } }),
      f.db.task.create({ data: { ...base, title: 'Rückruf Angehörige', dueAt: twoDays, source: 'manual' } }),
      f.db.task.create({ data: { ...base, title: 'Kontrolle', dueAt: new Date(now.getTime() - 60 * 60_000), source: 'manual', status: 'escalated' } }),
    ])
    const before = await overdueCount(f.unitA.id, now)
    // Eskalierte Aufgabe der laufenden Schicht und offene Einzelaufgabe zählen, die alte Routine nicht
    assert.ok(before >= 2)
    await expireBacklog(now)
    const old = await f.db.task.findUniqueOrThrow({ where: { id: slotOld.id } })
    assert.equal(old.status, 'skipped')
    assert.equal(old.autoClosed, 'shift_end')
    assert.equal(old.completedById, null)
    assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: manualOld.id } })).status, 'planned')
    assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: escalatedNow.id } })).status, 'escalated')
    // Zähler vor und nach dem Abschluss gleich (die alte Routine zählte schon vorher nicht)
    assert.equal(await overdueCount(f.unitA.id, now), before)
    assert.ok(await f.db.auditLog.findFirst({ where: { entityType: 'Task', entityId: slotOld.id, action: 'task.expire' } }))
  })

  test('Abwesenheit pausiert Aufgaben, Rückkehr öffnet sie, Verlegung nimmt sie mit', async () => {
    const { adtEvent } = await import('../../src/lib/adt')
    const actor = { orgId: f.org.id, actorId: f.lead.id, audit: async () => {}, via: 'app' as const }
    const now = new Date()
    const later = await f.db.task.create({ data: { orgId: f.org.id, unitId: f.unitA.id, residentId: f.resA.id, title: 'Spätere Massnahme', category: 'Grundpflege', dueAt: new Date(now.getTime() + 3 * 3600_000), source: 'manual' } })
    await adtEvent(actor, f.resA.id, { event: 'leave', at: new Date(now.getTime() - 60_000).toISOString(), reason: 'Spital' })
    assert.equal((await f.db.resident.findUniqueOrThrow({ where: { id: f.resA.id } })).status, 'absent')
    const paused = await f.db.task.findUniqueOrThrow({ where: { id: later.id } })
    assert.equal(paused.status, 'skipped')
    assert.equal(paused.autoClosed, 'absence')
    assert.equal(await f.db.careEpisode.count({ where: { residentId: f.resA.id, kind: 'absence', end: null } }), 1)
    await assert.rejects(adtEvent(actor, f.resA.id, { event: 'leave', reason: 'doppelt' }), /already absent/)

    await adtEvent(actor, f.resA.id, { event: 'return' })
    const resumed = await f.db.task.findUniqueOrThrow({ where: { id: later.id } })
    assert.equal(resumed.status, 'planned')
    assert.equal(resumed.autoClosed, null)
    assert.equal(await f.db.careEpisode.count({ where: { residentId: f.resA.id, kind: 'absence', end: null } }), 0)

    await adtEvent(actor, f.resA.id, { event: 'transfer', unitId: f.unitB.id, roomId: null, reason: 'Wechsel' })
    assert.equal((await f.db.task.findUniqueOrThrow({ where: { id: later.id } })).unitId, f.unitB.id)
    const stays = await f.db.careEpisode.findMany({ where: { residentId: f.resA.id, kind: 'stay' }, orderBy: { start: 'asc' } })
    assert.equal(stays.length, 2)
    assert.ok(stays[0].end)
    assert.equal(stays[1].unitId, f.unitB.id)
    assert.equal(stays[1].end, null)
    // Belegtes Zimmer wird abgewiesen
    await assert.rejects(adtEvent(actor, f.resA.id, { event: 'transfer', unitId: f.unitB.id, roomId: f.rooms.b1.id }), /no free bed/)
  })

  test('Import Medikationsplan und Kontakte: Zuordnung, Allergie-Abgleich, Audit', async () => {
    const { prepare, commit } = await import('../../src/lib/import/run')
    const { parseCsv } = await import('../../src/lib/import/csv')
    await f.db.resident.update({ where: { id: f.resB.id }, data: { allergies: ['Penicillin'] } })
    // Verordnungen importieren braucht «Verordnungen erfassen» (z. B. Heimärztin oder befristet bei der Einführung)
    const { DEFAULT_ROLES } = await import('../../src/lib/permissions')
    const phys = await f.db.role.create({ data: { orgId: f.org.id, key: 'physician', name: 'Arzt', permissions: DEFAULT_ROLES.find((r) => r.key === 'physician')!.permissions } })
    await f.db.roleAssignment.create({ data: { userId: f.lead.id, roleId: phys.id, locationId: f.loc.id } })
    const ctx = await ctxFor(f, f.lead.id)
    const csv = [
      'Nachname;Vorname;Geburtsdatum;Medikament;Morgen;Mittag;Abend;Nacht;Art;Reservedosis;Reserve max. pro Tag',
      'Beta;Test;01.01.1940;Metformin 500 mg;1;0;1;;Dauer;;',
      'Beta;Test;01.01.1940;Amoxicillin 1 g;1;;1;;Dauer;;',
      'Beta;Test;01.01.1940;Paracetamol 500 mg;;;;;Reserve;1 Tbl;4',
      'Unbekannt;Niemand;02.02.1930;Aspirin;1;;;;;;',
    ].join('\n')
    const { report, plan } = await prepare(ctx, 'medications', parseCsv(csv), 'it-meds')
    assert.deepEqual(report.rows.map((r) => r.status), ['create', 'error', 'create', 'error'], JSON.stringify(report.rows.map((r) => r.issues)))
    assert.equal(report.rows[1].issues[0].code, 'allergy')
    assert.equal(report.rows[3].issues[0].code, 'residentUnknown')
    await commit(ctx, 'medications', plan, { fileName: 'meds.csv', digest: 'it-meds' })
    const meds = await f.db.medication.findMany({ where: { residentId: f.resB.id }, orderBy: { name: 'asc' } })
    assert.deepEqual(meds.map((m) => m.name), ['Metformin 500 mg', 'Paracetamol 500 mg'])
    assert.deepEqual(meds[0].times, ['07:30', '17:30'])
    assert.equal(meds[1].kind, 'prn')
    // Zweiter Lauf: bereits aktiv → übersprungen
    const again = await prepare(ctx, 'medications', parseCsv(csv), 'it-meds-2')
    assert.equal(again.report.rows[0].status, 'skip')

    const contacts = 'Nachname;Vorname;Geburtsdatum;Kontakt;Beziehung;Telefon;Notfallkontakt\nBeta;Test;01.01.1940;Hans Beta;Sohn;079 000 00 00;ja'
    const c = await prepare(ctx, 'contacts', parseCsv(contacts), 'it-contacts')
    assert.equal(c.report.rows[0].status, 'create')
    await commit(ctx, 'contacts', c.plan, { fileName: 'contacts.csv', digest: 'it-contacts' })
    const saved = await f.db.contact.findFirstOrThrow({ where: { residentId: f.resB.id } })
    assert.equal(saved.isEmergency, true)
    assert.ok(await f.db.auditLog.findFirst({ where: { entityType: 'Contact', entityId: saved.id, action: 'contact.create' } }))
    // Pflege ohne Bereich B: Zeile wird abgewiesen
    const nurse = await ctxFor(f, f.nurseA.id)
    const n = await prepare(nurse, 'contacts', parseCsv(contacts), 'it-contacts-2')
    assert.equal(n.report.rows[0].status, 'error')
  })

  test('HL7 v2 ADT: Eintritt, Wiederholung, Verlegung, Austritt', async () => {
    const { processHl7 } = await import('../../src/lib/integrations/hl7v2-run')
    const { runIntegration } = await import('../../src/lib/integrations/registry')
    const actor = { orgId: f.org.id, actorId: f.lead.id, audit: async () => {}, via: 'hl7' as const }
    const msh = (type: string, id: string) => `MSH|^~\\&|KIS|SPITAL|CAREOS|HEIM|20261023101500||ADT^${type}|${id}|P|2.5`
    const pid = 'PID|1||756999' + f.tag.replace(/\D/g, '').padEnd(7, '0').slice(0, 7) + '^^^&2.16.756.5.32&ISO^SS||Gamma^Greta||19390505|F'
    const pv1 = (loc: string) => 'PV1|1|I|' + loc
    const run = (text: string) => runIntegration(null, f.org.id, 'import', { trigger: 'api', payload: { text, actor }, kind: 'hl7v2' })
    const a01 = [msh('A01', 'M1-' + f.tag), pid, pv1('WG A^A2')].join('\r')
    const r1 = await run(a01)
    assert.equal(r1.ok, true, JSON.stringify(r1))
    const greta = await f.db.resident.findFirstOrThrow({ where: { orgId: f.org.id, lastName: 'Gamma' } })
    assert.equal(greta.unitId, f.unitA.id)
    assert.equal(greta.roomId, f.rooms.a2.id)
    // Gleiche Kontroll-ID erneut: positiv quittiert, keine zweite Person
    const again = await run(a01)
    assert.equal((again.summary as { code?: string }).code, 'duplicate')
    assert.equal(await f.db.resident.count({ where: { orgId: f.org.id, lastName: 'Gamma' } }), 1)
    // Neue Nachricht A01 für dieselbe Person → AE
    const dup = await processHl7(f.org.id, actor, [msh('A01', 'M2-' + f.tag), pid, pv1('WG A^A2')].join('\r'), null)
    assert.equal(dup.ack, 'AE')
    assert.equal(dup.code, 'already_admitted')
    const r2 = await processHl7(f.org.id, actor, [msh('A02', 'M3-' + f.tag), pid, pv1('WG B')].join('\r'), null)
    assert.equal(r2.ack, 'AA')
    assert.equal((await f.db.resident.findUniqueOrThrow({ where: { id: greta.id } })).unitId, f.unitB.id)
    const r3 = await processHl7(f.org.id, actor, [msh('A03', 'M4-' + f.tag), pid, pv1('WG B')].join('\r'), null)
    assert.equal(r3.ack, 'AA')
    assert.equal((await f.db.resident.findUniqueOrThrow({ where: { id: greta.id } })).status, 'discharged')
    // Unbekannter Bereich
    const bad = await processHl7(f.org.id, actor, [msh('A01', 'M5-' + f.tag), pid.replace('Gamma', 'Delta'), pv1('Gibt es nicht')].join('\r'), null)
    assert.equal(bad.code, 'unit_unknown')
  })
})

