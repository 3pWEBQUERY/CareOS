import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  INVITABLE_ROLES, NEVER_SHARED, PORTAL_ROLES, SELF_ROLE, dayPlan, effectiveGrants, isSelfAccess, normalizeAudience, portalAppointment, portalVisit,
  threadWhere, updateAudiencesFor, updateWhere, visitWhere, type VisitRow,
} from './policy'

/**
 * Bewohnerportal: was der Zugang der Person selbst sieht – und dass er nie Daten einer anderen Person sieht.
 * Die Filter aus policy.ts werden hier gegen einen kleinen Datenbestand mit zwei Personen ausgewertet.
 */

// ───────── Minimaler Auswerter für die Prisma-Filter aus policy.ts (nur die verwendeten Operatoren) ─────────
type Row = Record<string, unknown>
const OPS = new Set(['in', 'not', 'lt', 'lte', 'gt', 'gte'])
function cmp(v: unknown, cond: Record<string, unknown>): boolean {
  return Object.entries(cond).every(([op, x]) => {
    if (op === 'in') return (x as unknown[]).includes(v)
    if (op === 'not') return v !== x
    const a = (v as Date)?.getTime?.() ?? (v as number)
    const b = (x as Date)?.getTime?.() ?? (x as number)
    if (v == null) return false
    return op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a >= b
  })
}
function matches(row: Row | null | undefined, where: Row): boolean {
  if (!row) return false
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((w) => matches(row, w))
    if (k === 'AND') return (cond as Row[]).every((w) => matches(row, w))
    const v = row[k]
    if (cond === null) return v == null
    if (cond instanceof Date || typeof cond !== 'object') return v === cond
    const c = cond as Row
    if (Object.keys(c).every((x) => OPS.has(x))) return cmp(v, c)
    return matches(v as Row | null, c) // Relation (z. B. access: { accountId })
  })
}

const now = new Date('2026-10-23T10:00:00')
const day = (h: string, d = '2026-10-23') => new Date(`${d}T${h}:00`)
const ME = { role: SELF_ROLE, residentId: 'r1', unitId: 'u1' }
const OTHER = { role: SELF_ROLE, residentId: 'r2', unitId: 'u1' }
const RELATIVE = { role: 'relative', residentId: 'r1', unitId: 'u1' }

test('Rolle: die Person selbst ist ein eigener Zugang, nicht über Kontakte einladbar', () => {
  assert.ok(PORTAL_ROLES.includes(SELF_ROLE))
  assert.ok(!INVITABLE_ROLES.includes(SELF_ROLE))
  assert.equal(isSelfAccess({ role: 'self' }), true)
  assert.equal(isSelfAccess({ role: 'relative' }), false)
  assert.equal(isSelfAccess({ role: 'legal_rep' }), false)
  assert.equal(isSelfAccess(null), false)
})

test('Wirksame Freigaben gelten für die Person selbst genauso (Modul, Widerruf, Austritt)', () => {
  const access = { grants: ['appointments', 'messages', 'visits', 'updates'], consentScope: ['appointments', 'messages', 'visits', 'updates'], revokedAt: null, acceptedAt: now, accountId: 'acc-me' }
  const ok = { moduleOn: true, access, account: { lockedAt: null }, resident: { status: 'active', anonymisedAt: null } }
  assert.deepEqual(effectiveGrants(ok), ['appointments', 'updates', 'messages', 'visits'])
  assert.deepEqual(effectiveGrants({ ...ok, moduleOn: false }), [])
  assert.deepEqual(effectiveGrants({ ...ok, access: { ...access, revokedAt: now } }), [])
  assert.deepEqual(effectiveGrants({ ...ok, resident: { status: 'discharged', anonymisedAt: null } }), [])
  // Klinische Bereiche sind auch für die Person selbst keine Freigabe
  for (const n of NEVER_SHARED) assert.deepEqual(effectiveGrants({ ...ok, access: { ...access, grants: [n], consentScope: [n] } }), [], n)
})

test('Mitteilungen: Empfängerkreis trennt Angehörige und die Person selbst', () => {
  assert.deepEqual(updateAudiencesFor(SELF_ROLE), ['residents', 'all'])
  assert.deepEqual(updateAudiencesFor('relative'), ['family', 'all'])
  assert.deepEqual(updateAudiencesFor('legal_rep'), ['family', 'all'])
  assert.equal(normalizeAudience('residents'), 'residents')
  assert.equal(normalizeAudience('x'), 'family')
  assert.equal(normalizeAudience(undefined), 'family')
})

test('Mitteilungen: nur eigene, eigener Bereich oder ganze Organisation – nie die einer anderen Person', () => {
  const base = { orgId: 'o1', publishedAt: day('08:00'), expiresAt: null }
  const rows: Row[] = [
    { id: 'mine', ...base, residentId: 'r1', unitId: 'u1', audience: 'residents' },
    { id: 'other', ...base, residentId: 'r2', unitId: 'u1', audience: 'residents' },
    { id: 'unit', ...base, residentId: null, unitId: 'u1', audience: 'all' },
    { id: 'otherUnit', ...base, residentId: null, unitId: 'u2', audience: 'all' },
    { id: 'org', ...base, residentId: null, unitId: null, audience: 'residents' },
    { id: 'family', ...base, residentId: 'r1', unitId: 'u1', audience: 'family' },
    { id: 'otherOrg', ...base, orgId: 'o2', residentId: 'r1', unitId: 'u1', audience: 'residents' },
    { id: 'future', ...base, publishedAt: day('12:00'), residentId: 'r1', unitId: 'u1', audience: 'residents' },
    { id: 'expired', ...base, expiresAt: day('09:00'), residentId: 'r1', unitId: 'u1', audience: 'residents' },
  ]
  const ids = (cur: typeof ME) => rows.filter((r) => matches(r, updateWhere('o1', cur, now))).map((r) => r.id)
  assert.deepEqual(ids(ME), ['mine', 'unit', 'org'])
  assert.deepEqual(ids(OTHER), ['other', 'unit', 'org'])
  // Angehörige derselben Person sehen die Mitteilungen «für Bewohnende» nicht, aber jene für Angehörige
  assert.deepEqual(ids(RELATIVE), ['unit', 'family'])
})

test('Gespräche: nur die eigenen, an die eigene Person gebunden', () => {
  const rows: Row[] = [
    { id: 'mine', orgId: 'o1', residentId: 'r1', access: { accountId: 'acc-me' } },
    { id: 'relative', orgId: 'o1', residentId: 'r1', access: { accountId: 'acc-daughter' } },
    { id: 'other', orgId: 'o1', residentId: 'r2', access: { accountId: 'acc-me' } },
    { id: 'orphan', orgId: 'o1', residentId: 'r1', access: null },
  ]
  assert.deepEqual(rows.filter((r) => matches(r, threadWhere('o1', ME, 'acc-me'))).map((r) => r.id), ['mine'])
})

const visit = (o: Partial<VisitRow> & { id: string }): VisitRow => ({
  residentId: 'r1', start: day('14:00', '2026-10-24'), end: day('15:00', '2026-10-24'), visitors: 1, note: null, status: 'requested', reply: null,
  visitorName: null, decidedAt: null, createdAt: now, appointmentId: null, access: null, ...o,
})
const daughter = { accountId: 'acc-daughter', role: 'relative', inviteName: 'Anna Huber', account: { name: 'Anna Huber' } }
const me = { accountId: 'acc-me', role: SELF_ROLE, inviteName: 'Margrit Huber', account: { name: 'Margrit Huber' } }

test('Besuche: die Person selbst sieht offene und bestätigte Besuche ihrer Angehörigen, nie die einer anderen Person', () => {
  const since = new Date('2026-09-23')
  const rows = [
    visit({ id: 'daughterOpen', access: daughter }),
    visit({ id: 'daughterOk', status: 'confirmed', access: daughter }),
    visit({ id: 'daughterDeclined', status: 'declined', access: daughter }),
    visit({ id: 'mine', access: me, visitorName: 'Ruth Meier' }),
    visit({ id: 'mineCancelled', status: 'cancelled', access: me, visitorName: 'Ruth Meier' }),
    visit({ id: 'other', residentId: 'r2', status: 'confirmed', access: { ...daughter, accountId: 'acc-x' } }),
    visit({ id: 'old', status: 'confirmed', end: new Date('2026-09-01'), access: daughter }),
  ].map((v) => ({ ...v, orgId: 'o1' }))
  const self = rows.filter((r) => matches(r as unknown as Row, visitWhere('o1', ME, 'acc-me', since))).map((r) => r.id)
  assert.deepEqual(self, ['daughterOpen', 'daughterOk', 'mine', 'mineCancelled'])
  // Angehörige: weiterhin nur die eigenen Anfragen
  const rel = rows.filter((r) => matches(r as unknown as Row, visitWhere('o1', RELATIVE, 'acc-daughter', since))).map((r) => r.id)
  assert.deepEqual(rel, ['daughterOpen', 'daughterOk', 'daughterDeclined'])
})

test('Besuche: Projektion für die Person selbst – Notizen anderer bleiben beim Team', () => {
  const v = visit({ id: 'v1', status: 'confirmed', note: 'Bitte nichts verraten, Überraschung', reply: 'Gerne', decidedAt: now, appointmentId: 'a1', access: daughter })
  const p = portalVisit(v, ME, 'acc-me')!
  assert.equal(p.own, false)
  assert.equal(p.who, 'Anna Huber')
  assert.equal(p.note, null)
  assert.equal(p.reply, null)
  assert.equal(p.decidedAt, null)
  assert.equal(p.appointmentId, 'a1')
  // Eigene Anmeldung: vollständig, «wer kommt» = erfasster Name
  const own = portalVisit(visit({ id: 'v2', note: 'Mit Hund', reply: 'Bitte am Empfang melden', access: me, visitorName: 'Ruth Meier' }), ME, 'acc-me')!
  assert.equal(own.own, true)
  assert.equal(own.who, 'Ruth Meier')
  assert.equal(own.note, 'Mit Hund')
  assert.equal(own.reply, 'Bitte am Empfang melden')
  // Abgelehnte oder zurückgezogene Anfragen anderer: nicht sichtbar
  assert.equal(portalVisit(visit({ id: 'v3', status: 'declined', access: daughter }), ME, 'acc-me'), null)
  assert.equal(portalVisit(visit({ id: 'v4', status: 'cancelled', access: daughter }), ME, 'acc-me'), null)
  // Besuch einer anderen Person: nie, auch wenn er durch einen Fehler im Filter geladen würde
  assert.equal(portalVisit(visit({ id: 'v5', residentId: 'r2', status: 'confirmed', access: me }), ME, 'acc-me'), null)
  // Termin aus der Bestätigung nur bei bestätigten Besuchen
  assert.equal(portalVisit(visit({ id: 'v6', status: 'requested', appointmentId: 'a2', access: daughter }), ME, 'acc-me')!.appointmentId, null)
})

test('Termine: Therapieeinheiten zeigen die Therapieart, klinische Titel bleiben verborgen', () => {
  const a = { id: 'a', at: day('10:00'), title: 'Gangschulung nach Hüft-TP', place: 'Therapieraum', done: false }
  const th = portalAppointment({ ...a, kind: 'therapy' }, 'physio')
  assert.equal(th.discipline, 'physio')
  assert.equal(th.title, null)
  assert.ok(!('notes' in th))
  assert.equal(portalAppointment({ ...a, kind: 'therapy' }, 'unknown').discipline, null)
  assert.equal(portalAppointment({ ...a, kind: 'therapy' }).discipline, null)
  // Therapieart nur bei Therapieterminen
  assert.equal(portalAppointment({ ...a, kind: 'physician' }, 'physio').discipline, null)
  assert.equal(portalAppointment({ ...a, kind: 'physician' }, 'physio').title, null)
  assert.equal(portalAppointment({ ...a, kind: 'other', title: 'Coiffeur' }).title, 'Coiffeur')
})

test('«Mein Tag»: heute und die nächsten 7 Tage, nur Einträge der eigenen Person', () => {
  const items = [
    { key: 'past', at: day('08:00'), kind: 'appointment' as const, residentId: 'r1' },
    { key: 'visitNow', at: day('09:30'), until: day('11:00'), kind: 'visit' as const, residentId: 'r1' },
    { key: 'later', at: day('16:00'), kind: 'appointment' as const, residentId: 'r1' },
    { key: 'tomorrow', at: day('10:00', '2026-10-24'), kind: 'appointment' as const, residentId: 'r1' },
    { key: 'in7', at: day('10:00', '2026-10-30'), kind: 'appointment' as const, residentId: 'r1' },
    { key: 'in8', at: day('10:00', '2026-10-31'), kind: 'appointment' as const, residentId: 'r1' },
    { key: 'yesterday', at: day('10:00', '2026-10-22'), kind: 'appointment' as const, residentId: 'r1' },
    { key: 'otherPerson', at: day('12:00'), kind: 'appointment' as const, residentId: 'r2' },
  ]
  const plan = dayPlan(items, { residentId: 'r1' }, now)
  assert.deepEqual(plan.today.map((i) => [i.key, i.past]), [['past', true], ['visitNow', false], ['later', false]])
  assert.deepEqual(plan.upcoming.map((i) => i.key), ['tomorrow', 'in7'])
})

// ───────── Struktur: Datenzugriffe des Portals laufen über die Filter aus policy.ts ─────────

const ROOT = join(__dirname, '..', '..', '..')

test('Struktur: Gespräche, Besuche und Mitteilungen werden nur über die Policy-Filter geladen', () => {
  const data = readFileSync(join(ROOT, 'src/lib/portal/data.ts'), 'utf8')
  assert.ok(/visitRequest\.findMany\(\{\s*where: visitWhere\(/.test(data), 'Besuche über visitWhere')
  assert.ok(/portalUpdate\.findMany\(\{\s*where: updateWhere\(/.test(data), 'Mitteilungen über updateWhere')
  assert.equal((data.match(/portalThread\.find(Many|First)\(/g) ?? []).length, (data.match(/threadWhere\(/g) ?? []).length, 'jede Gesprächsabfrage über threadWhere')
  // Therapiepläne: nur die Art (nie Ziel, Anleitung, Ergebnis), nur für die eigene Person
  const plans = data.match(/therapyPlan\.findMany\(\{[^\n]*\}\)/g) ?? []
  assert.equal(plans.length, 1)
  assert.ok(plans[0].includes('residentId: cur.residentId'))
  assert.ok(plans[0].includes("select: { id: true, discipline: true }"))
  for (const f of ['goal', 'careInstructions', 'outcome']) assert.ok(!plans[0].includes(f), f)
})

test('Struktur: «Mein Tag» fragt die Datenbank nicht selbst ab', () => {
  const src = readFileSync(join(ROOT, 'src/app/portal/(in)/SelfHome.tsx'), 'utf8')
  assert.ok(!/@\/lib\/db/.test(src))
  assert.ok(/from '@\/lib\/portal\/data'/.test(src))
})
