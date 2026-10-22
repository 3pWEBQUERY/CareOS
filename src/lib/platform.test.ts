import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LabPayload, labFlag, numericValue, parseRange } from './integrations/lab'
import { formatLine, sanitize } from './log'
import { routeLabel } from './metrics'
import { jobState } from './health-core'
import { adoption, median } from './usage-core'

test('Labor: Werte, Referenzbereiche und Beurteilung', () => {
  assert.equal(numericValue('5,4'), 5.4)
  assert.equal(numericValue('< 0.5'), 0.5)
  assert.equal(numericValue('positiv'), null)
  assert.deepEqual(parseRange('3,5 – 5,1'), { lo: 3.5, hi: 5.1 })
  assert.deepEqual(parseRange('< 5'), { lo: null, hi: 5 })
  assert.equal(parseRange('negativ'), null)
  assert.equal(labFlag({ value: '131', refRange: '135-145' }), 'low')
  assert.equal(labFlag({ value: 150, refRange: '135-145' }), 'high')
  assert.equal(labFlag({ value: '140', refRange: '135-145' }), 'normal')
  assert.equal(labFlag({ value: '140', refRange: '135-145', flag: 'critical' }), 'critical')
  assert.equal(labFlag({ value: 'positiv' }), null)
  assert.equal(LabPayload.safeParse([{ name: 'Na', value: '131', collectedAt: '2026-10-22T07:30:00+02:00' }]).success, false) // ohne Person
  assert.equal(LabPayload.safeParse([{ residentId: 'r1', name: 'Na', value: '131', collectedAt: '2026-10-22T07:30:00+02:00' }]).success, true)
})

test('Logging: Geheimnisse maskiert, Fehler serialisiert', () => {
  const s = sanitize({ email: 'a@b.ch', password: 'x', nested: { token: 't', ok: 1 }, err: new Error('boom') }) as Record<string, unknown>
  assert.equal(s.email, '[redacted]')
  assert.equal(s.password, '[redacted]')
  assert.deepEqual((s.nested as Record<string, unknown>).token, '[redacted]')
  assert.equal((s.err as { message: string }).message, 'boom')
  const line = JSON.parse(formatLine('error', 'x.y', { n: 1n, at: new Date('2026-10-22T08:00:00Z') }, true, new Date('2026-10-22T08:00:00Z')))
  assert.deepEqual(line, { time: '2026-10-22T08:00:00.000Z', level: 'error', msg: 'x.y', n: '1', at: '2026-10-22T08:00:00.000Z' })
  assert.equal(formatLine('info', 'hallo', {}, false), '[info] hallo')
})

test('Metriken: Routen ohne Kennungen', () => {
  assert.equal(routeLabel('/residents/cmabcdefghijklmnopqrstuv12/vitals?x=1'), '/residents/:id/vitals')
  assert.equal(routeLabel('/quality/123'), '/quality/:id')
  assert.equal(routeLabel('/tasks'), '/tasks')
})

test('Health: Jobzustand', () => {
  const now = new Date('2026-10-22T10:00:00Z')
  const run = (minAgo: number, ok: boolean | null = true) => ({ startedAt: new Date(now.getTime() - minAgo * 60_000), finishedAt: now, ok })
  assert.equal(jobState(null, 15 * 60_000, now, 60_000, false), 'pending')
  assert.equal(jobState(null, 15 * 60_000, now, 3600_000, false), 'stale')
  assert.equal(jobState(run(3), 15 * 60_000, now, 3600_000, false), 'ok')
  assert.equal(jobState(run(30), 15 * 60_000, now, 3600_000, false), 'stale')
  assert.equal(jobState(run(30), 15 * 60_000, now, 3600_000, true), 'disabled')
  assert.equal(jobState(run(3, false), 15 * 60_000, now, 3600_000, false), 'failing')
})

test('Nutzung: Module und Median', () => {
  const a = adoption([
    { action: 'observation.create', userId: 'u1', n: 3 },
    { action: 'observation.correct', userId: 'u1', n: 1 },
    { action: 'handover.note.ai', userId: 'u2', n: 2 },
    { action: 'vitals.create', userId: 'u2', n: 5 },
  ])
  assert.deepEqual(a.find((m) => m.key === 'chart'), { key: 'chart', users: 1, events: 4 })
  assert.deepEqual(a.find((m) => m.key === 'ai'), { key: 'ai', users: 1, events: 2 })
  assert.deepEqual(a.find((m) => m.key === 'handover'), { key: 'handover', users: 1, events: 2 })
  assert.equal(median([]), null)
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([4, 1, 3, 2]), 2.5)
})
