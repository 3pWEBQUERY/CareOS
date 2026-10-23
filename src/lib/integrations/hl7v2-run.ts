import 'server-only'
import { db } from '@/lib/db'
import { headerKey } from '@/lib/import/csv'
import { AdtError, admit, adtEvent, type AdtActor } from '@/lib/adt'
import { Hl7Error, parseHl7, toAdtIntent, type AdtIntent } from '@/lib/integrations/hl7v2'

/**
 * HL7 v2 ADT ausführen (Adapter «hl7v2», src/lib/integrations/registry.ts): Person, Bereich und Zimmer zuordnen und den
 * Vorgang über src/lib/adt.ts ausführen – gleiche Prüfungen, Pflegeepisoden, Aufgabenregeln und Audit wie in der Akte.
 * Ergebnis nur mit Zählwerten und Codes (keine Gesundheitsdaten); Wiederholung derselben Kontroll-ID wird erkannt.
 */
export type Hl7Result = { ack: 'AA' | 'AE' | 'AR'; code: string; controlId: string; event: string | null; residentId?: string; duplicate?: boolean }

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && headerKey(a) === headerKey(b)

async function findResident(orgId: string, p: AdtIntent['person']) {
  if (p.insuranceNo) {
    const r = await db.resident.findFirst({ where: { orgId, insuranceNo: p.insuranceNo, anonymisedAt: null }, orderBy: { admittedAt: 'desc' } })
    if (r) return r
  }
  if (!p.birthDate) return null
  const birth = new Date(p.birthDate + 'T00:00:00Z')
  const rs = await db.resident.findMany({ where: { orgId, birthDate: birth, anonymisedAt: null }, orderBy: { admittedAt: 'desc' } })
  return rs.find((r) => same(r.lastName, p.lastName) && same(r.firstName, p.firstName)) ?? null
}

async function findLocation(orgId: string, loc: AdtIntent['location']) {
  if (!loc.unit) return { unit: null, roomId: null }
  const units = await db.unit.findMany({ where: { orgId }, select: { id: true, name: true, shortName: true } })
  const unit = units.find((u) => same(u.name, loc.unit) || same(u.shortName, loc.unit)) ?? null
  if (!unit || !loc.room) return { unit, roomId: null }
  const room = await db.room.findFirst({ where: { unitId: unit.id, number: loc.room }, select: { id: true } })
  return { unit, roomId: room?.id ?? null }
}

export async function processHl7(orgId: string, actor: AdtActor, text: string, integrationId: string | null): Promise<Hl7Result> {
  let intent: AdtIntent
  try {
    intent = toAdtIntent(parseHl7(text))
  } catch (e) {
    if (e instanceof Hl7Error) return { ack: e.ack, code: e.code, controlId: '', event: null }
    return { ack: 'AR', code: 'parse_error', controlId: '', event: null }
  }
  const base = { controlId: intent.controlId, event: intent.event }
  // Wiederholte Zustellung (gleiche Kontroll-ID, bereits verarbeitet): erneut positiv quittieren, nichts doppelt ausführen
  if (intent.controlId) {
    const prev = await db.integrationRun.findFirst({ where: { orgId, integrationId: integrationId ?? 'kind:hl7v2', ok: true, summary: { path: ['controlId'], equals: intent.controlId } }, select: { id: true } })
    if (prev) return { ack: 'AA', code: 'duplicate', duplicate: true, ...base }
  }
  const iso = (d: Date | null) => (d && d.getTime() <= Date.now() + 60_000 ? d.toISOString() : undefined)
  const r = await findResident(orgId, intent.person)
  try {
    switch (intent.event) {
      case 'A01': {
        if (r && (r.status === 'active' || r.status === 'absent')) return { ack: 'AE', code: 'already_admitted', residentId: r.id, ...base }
        const { unit, roomId } = await findLocation(orgId, intent.location)
        if (!unit) return { ack: 'AE', code: 'unit_unknown', ...base }
        if (!intent.person.birthDate) return { ack: 'AE', code: 'pid_birth', ...base }
        const created = await admit({ ...actor, via: 'hl7' }, {
          unitId: unit.id, roomId, firstName: intent.person.firstName, lastName: intent.person.lastName, birthDate: intent.person.birthDate,
          sex: intent.person.sex, insuranceNo: intent.person.insuranceNo, allergies: [], rea: 'unknown',
          admittedAt: iso(intent.admittedAt ?? intent.at), reason: 'Eintritt (HL7 A01)',
        })
        return { ack: 'AA', code: roomId || !intent.location.room ? 'admitted' : 'admitted_without_room', residentId: created.id, ...base }
      }
      case 'A02': {
        if (!r) return { ack: 'AE', code: 'resident_unknown', ...base }
        const { unit, roomId } = await findLocation(orgId, intent.location)
        if (!unit) return { ack: 'AE', code: 'unit_unknown', ...base }
        await adtEvent({ ...actor, via: 'hl7' }, r.id, { event: 'transfer', unitId: unit.id, roomId, at: iso(intent.at), reason: 'HL7 A02' })
        return { ack: 'AA', code: 'transferred', residentId: r.id, ...base }
      }
      case 'A03':
        if (!r) return { ack: 'AE', code: 'resident_unknown', ...base }
        await adtEvent({ ...actor, via: 'hl7' }, r.id, { event: 'discharge', at: iso(intent.dischargedAt ?? intent.at), deceased: intent.person.deceased, reason: 'HL7 A03' })
        return { ack: 'AA', code: 'discharged', residentId: r.id, ...base }
      case 'A21':
        if (!r) return { ack: 'AE', code: 'resident_unknown', ...base }
        await adtEvent({ ...actor, via: 'hl7' }, r.id, { event: 'leave', at: iso(intent.at), reason: 'Beurlaubung (HL7 A21)' })
        return { ack: 'AA', code: 'leave', residentId: r.id, ...base }
      case 'A22':
        if (!r) return { ack: 'AE', code: 'resident_unknown', ...base }
        await adtEvent({ ...actor, via: 'hl7' }, r.id, { event: 'return', at: iso(intent.at) })
        return { ack: 'AA', code: 'returned', residentId: r.id, ...base }
    }
  } catch (e) {
    if (e instanceof AdtError) return { ack: 'AE', code: e.code, residentId: r?.id, ...base }
    throw e
  }
}
