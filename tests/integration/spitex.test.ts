/**
 * Integrationstest Spitex gegen Postgres: Einsätze aus Wochenvorlagen gleichzeitig ohne Duplikate (Advisory Lock,
 * @@unique([templateId, date])), Durchführung mit Verlaufseintrag und KLV-Minuten, Wiederholung als «übernommen».
 * Ohne DATABASE_URL übersprungen (siehe fixture.ts).
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createFixture, ctxFor, dbOpts, dropFixture, type Fixture } from './fixture'

describe('Spitex (Postgres)', dbOpts, () => {
  let f: Fixture
  before(async () => {
    f = await createFixture()
    await f.db.unit.update({ where: { id: f.unitA.id }, data: { kind: 'homecare' } })
  })
  after(async () => {
    if (f) await dropFixture(f)
    const { db } = await import('../../src/lib/db')
    await db.$disconnect()
  })

  test('Einsätze aus der Wochenvorlage: gleichzeitig erzeugt, ohne Duplikate, bevorzugte Person zugewiesen', async () => {
    const { ensureVisitsForDay, invalidateVisitGeneration } = await import('../../src/lib/spitex-data')
    const { addDays, dbDate, startOfDay } = await import('../../src/lib/time')
    const day = addDays(startOfDay(new Date()), 1)
    await f.db.homeCareTemplate.create({
      data: {
        orgId: f.org.id, residentId: f.resA.id, weekdays: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '08:40', preferredUserId: f.nurseA.id,
        services: [{ klv: 'c', label: 'Körperpflege', minutes: 30 }, { klv: 'b', label: 'Medikamente', minutes: 10 }], startDate: dbDate(startOfDay(new Date())), createdById: f.lead.id,
      },
    })
    await Promise.all([1, 2, 3, 4].map(() => ensureVisitsForDay(f.unitA.id, day)))
    const visits = await f.db.homeCareVisit.findMany({ where: { unitId: f.unitA.id, date: dbDate(day) }, include: { services: true } })
    assert.equal(visits.length, 1)
    assert.equal(visits[0].assigneeId, f.nurseA.id)
    assert.equal(visits[0].services.length, 2)
    // Nach Invalidierung erneut: weiterhin ein Einsatz
    await invalidateVisitGeneration(f.unitA.id)
    await ensureVisitsForDay(f.unitA.id, day)
    assert.equal(await f.db.homeCareVisit.count({ where: { unitId: f.unitA.id, date: dbDate(day) } }), 1)
    // Station (kein Einsatzgebiet) erzeugt keine Einsätze
    await ensureVisitsForDay(f.unitB.id, day)
    assert.equal(await f.db.homeCareVisit.count({ where: { unitId: f.unitB.id } }), 0)
  })

  test('Durchführung: Beginn und Abschluss mit Leistungen, Verlaufseintrag, Wiederholung gilt als übernommen', async () => {
    const { applyVisitStep } = await import('../../src/lib/spitex-visit')
    const { klvTotals } = await import('../../src/lib/spitex')
    const { dbDate, startOfDay } = await import('../../src/lib/time')
    const now = new Date()
    const v = await f.db.homeCareVisit.create({
      data: {
        orgId: f.org.id, unitId: f.unitA.id, residentId: f.resA.id, assigneeId: f.nurseA.id, date: dbDate(startOfDay(now)),
        plannedStart: new Date(now.getTime() - 30 * 60_000), plannedEnd: new Date(now.getTime() + 10 * 60_000),
        services: { create: [{ klv: 'c', label: 'Körperpflege', plannedMin: 30, order: 0 }, { klv: 'a', label: 'Beratung', plannedMin: 15, order: 1 }] },
      },
      include: { services: { orderBy: { order: 'asc' } } },
    })
    const ctx = await ctxFor(f, f.nurseA.id)
    const started = new Date(now.getTime() - 20 * 60_000)
    assert.deepEqual(await applyVisitStep(ctx, { visitId: v.id, step: 'finish', services: [] }, now), { ok: false, reason: 'visitNotStarted' })
    assert.equal((await applyVisitStep(ctx, { visitId: v.id, step: 'start' }, started)).ok, true)
    assert.deepEqual(await applyVisitStep(ctx, { visitId: v.id, step: 'start' }, started), { ok: true, duplicate: true })
    const r = await applyVisitStep(ctx, { visitId: v.id, step: 'finish', services: [{ id: v.services[0].id, done: true, minutes: 25 }, { id: v.services[1].id, done: false, minutes: null }], note: 'Gut gelaunt.' }, now)
    assert.equal(r.ok, true)
    const done = await f.db.homeCareVisit.findUniqueOrThrow({ where: { id: v.id }, include: { services: true } })
    assert.equal(done.status, 'done')
    assert.equal(done.actualStart?.getTime(), started.getTime())
    assert.deepEqual(klvTotals([done]), { a: 0, b: 0, c: 25, total: 25, visits: 1 })
    const obs = await f.db.observation.findUniqueOrThrow({ where: { id: done.observationId! } })
    assert.match(obs.text, /Körperpflege \(c, 25 Min\.\)/)
    assert.match(obs.text, /Nicht erbracht: Beratung/)
    assert.match(obs.text, /Gut gelaunt\./)
    // Offline wiederholt: übernommen; ein abgeschlossener Einsatz lässt sich auch von der Leitung nicht erneut beginnen
    assert.deepEqual(await applyVisitStep(ctx, { visitId: v.id, step: 'finish', services: [] }, now), { ok: true, duplicate: true })
    const lead = await ctxFor(f, f.lead.id)
    const other = await applyVisitStep(lead, { visitId: v.id, step: 'start' }, now)
    assert.equal(other.ok === false && other.reason, 'visitClosed')
  })
})
