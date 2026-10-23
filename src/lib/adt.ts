import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { emit } from '@/lib/events'
import type { AuditEntry } from '@/lib/audit'
import { invalidateTaskGeneration, OPEN_STATUSES } from '@/lib/tasks'
import { dbDate, parseDateKey, startOfDay } from '@/lib/time'

/**
 * Patientenadministration (ADT) über die Schnittstelle (PRD §40, §41, §43): Eintritt, Verlegung, Abwesenheit
 * (z. B. Spitalaufenthalt), Rückkehr und Austritt. Jeder Vorgang wird protokolliert, als Domain Event verteilt
 * und als Pflegeepisode (CareEpisode) geführt. Akten werden nie gelöscht.
 */
export type AdtActor = { orgId: string; actorId: string | null; audit: (e: AuditEntry) => Promise<unknown>; /** Herkunft für Events und Audit (Standard api) */ via?: 'api' | 'app' | 'hl7' }
export class AdtError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/
const when = z.iso.datetime({ offset: true }).optional()

export const AdmitBody = z.object({
  unitId: z.string().min(1),
  roomId: z.string().min(1).nullish(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthDate: z.string().regex(dateKeyRe, 'YYYY-MM-DD'),
  sex: z.enum(['f', 'm', 'd']).nullish(),
  insuranceNo: z.string().trim().max(40).nullish(),
  physician: z.string().trim().max(120).nullish(),
  allergies: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  rea: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  admittedAt: when,
  reason: z.string().trim().max(200).default('Eintritt'),
}).strict()

export const EventBody = z.discriminatedUnion('event', [
  z.object({ event: z.literal('transfer'), unitId: z.string().min(1), roomId: z.string().min(1).nullish(), at: when, reason: z.string().trim().max(200).optional() }).strict(),
  z.object({ event: z.literal('leave'), at: when, reason: z.string().trim().min(1).max(200), expectedReturn: z.string().regex(dateKeyRe, 'YYYY-MM-DD').optional() }).strict(),
  z.object({ event: z.literal('return'), at: when, roomId: z.string().min(1).nullish() }).strict(),
  z.object({ event: z.literal('discharge'), at: when, deceased: z.boolean().default(false), reason: z.string().trim().max(200).optional() }).strict(),
])
export type AdtEvent = z.infer<typeof EventBody>

async function freeRoom(roomId: string, unitId: string, exceptResidentId?: string) {
  const room = await db.room.findFirst({ where: { id: roomId, unitId }, include: { residents: { where: { status: { in: ['active', 'absent'] }, ...(exceptResidentId ? { id: { not: exceptResidentId } } : {}) }, select: { id: true } } } })
  if (!room) throw new AdtError(422, 'validation_failed', 'roomId does not belong to unitId')
  if (room.residents.length >= room.beds) throw new AdtError(409, 'room_occupied', 'Room has no free bed')
}

async function unitOf(orgId: string, unitId: string) {
  const unit = await db.unit.findFirst({ where: { id: unitId, orgId }, select: { id: true } })
  if (!unit) throw new AdtError(422, 'validation_failed', 'unitId not found in organisation')
  return unit
}

const atOrNow = (s?: string) => {
  const d = s ? new Date(s) : new Date()
  if (d.getTime() > Date.now() + 5 * 60_000) throw new AdtError(422, 'validation_failed', 'at must not be in the future')
  return d
}

export async function admit(actor: AdtActor, b: z.infer<typeof AdmitBody>) {
  await unitOf(actor.orgId, b.unitId)
  if (b.roomId) await freeRoom(b.roomId, b.unitId)
  const birth = parseDateKey(b.birthDate)
  if (Number.isNaN(birth.getTime()) || birth > new Date() || birth.getFullYear() < 1900) throw new AdtError(422, 'validation_failed', 'birthDate invalid')
  const at = atOrNow(b.admittedAt)
  const r = await db.resident.create({
    data: {
      orgId: actor.orgId, unitId: b.unitId, roomId: b.roomId ?? null, firstName: b.firstName, lastName: b.lastName, birthDate: dbDate(birth),
      sex: b.sex ?? null, insuranceNo: b.insuranceNo ?? null, physician: b.physician ?? null, allergies: b.allergies, rea: b.rea,
      status: 'active', admittedAt: at, nutrition: { create: {} }, episodes: { create: { start: at, reason: b.reason, kind: 'stay', unitId: b.unitId, createdById: actor.actorId } },
    },
    include: { unit: { select: { id: true, name: true } }, room: { select: { number: true } } },
  })
  await actor.audit({ action: 'adt.admit', entityType: 'Resident', entityId: r.id, after: { unitId: r.unitId, roomId: r.roomId, admittedAt: at, reason: b.reason }, context: { residentId: r.id } })
  await emit({ orgId: actor.orgId, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: actor.actorId, payload: { adt: 'admit', via: actor.via ?? 'api' } })
  invalidateTaskGeneration(r.unitId)
  return r
}

export async function adtEvent(actor: AdtActor, residentId: string, e: AdtEvent) {
  const r = await db.resident.findFirst({ where: { id: residentId, orgId: actor.orgId } })
  if (!r) throw new AdtError(404, 'not_found', 'Resident not found')
  if (r.status === 'discharged' || r.status === 'deceased') throw new AdtError(409, 'not_current', 'Resident is discharged')
  const at = atOrNow(e.at)
  const before = { status: r.status, unitId: r.unitId, roomId: r.roomId, dischargedAt: r.dischargedAt }
  let data: Parameters<typeof db.resident.update>[0]['data']
  let expectedEnd: Date | null = null
  switch (e.event) {
    case 'transfer':
      await unitOf(actor.orgId, e.unitId)
      if (e.roomId) await freeRoom(e.roomId, e.unitId, r.id)
      if (e.unitId === r.unitId && (e.roomId ?? null) === r.roomId) throw new AdtError(422, 'validation_failed', 'No change')
      data = { unitId: e.unitId, roomId: e.roomId ?? null }
      break
    case 'leave':
      if (r.status === 'absent') throw new AdtError(409, 'conflict', 'Resident is already absent')
      if (e.expectedReturn) {
        expectedEnd = parseDateKey(e.expectedReturn)
        if (Number.isNaN(expectedEnd.getTime()) || expectedEnd < startOfDay(at)) throw new AdtError(422, 'validation_failed', 'expectedReturn must not be before at')
      }
      data = { status: 'absent' }
      break
    case 'return':
      if (r.status !== 'absent') throw new AdtError(409, 'conflict', 'Resident is not absent')
      if (e.roomId) await freeRoom(e.roomId, r.unitId, r.id)
      data = { status: 'active', ...(e.roomId ? { roomId: e.roomId } : {}) }
      break
    case 'discharge':
      data = { status: e.deceased ? 'deceased' : 'discharged', dischargedAt: at, roomId: null }
      break
  }
  const tasks = { paused: 0, resumed: 0, moved: 0, removed: 0, expired: 0 }
  await db.$transaction(async (tx) => {
    // Versionsprüfung: gleichzeitige Änderung in der App gewinnt nicht stillschweigend (PRD §32)
    const res = await tx.resident.updateMany({ where: { id: r.id, updatedAt: r.updatedAt }, data })
    if (res.count !== 1) throw new AdtError(409, 'conflict', 'Resident was changed concurrently, retry')
    const reason = 'reason' in e && e.reason ? e.reason : null
    switch (e.event) {
      case 'transfer':
        if (e.unitId !== r.unitId) {
          // Aufenthalt im alten Bereich endet, neuer beginnt; offene Aufgaben und Serien folgen der Person
          await tx.careEpisode.updateMany({ where: { residentId: r.id, end: null, kind: 'stay' }, data: { end: at } })
          await tx.careEpisode.create({ data: { residentId: r.id, start: at, kind: 'stay', unitId: e.unitId, reason: reason ?? 'transfer', createdById: actor.actorId } })
          tasks.moved = (await tx.task.updateMany({ where: { residentId: r.id, status: { in: [...OPEN_STATUSES] } }, data: { unitId: e.unitId } })).count
          await tx.taskTemplate.updateMany({ where: { residentId: r.id }, data: { unitId: e.unitId } })
        }
        break
      case 'leave':
        await tx.careEpisode.create({ data: { residentId: r.id, start: at, kind: 'absence', reason: e.reason, expectedEnd, createdById: actor.actorId } })
        // Aufgaben ab Beginn der Abwesenheit pausieren (nicht überfällig, nicht eskaliert); Rückkehr öffnet sie wieder
        tasks.paused = (await tx.task.updateMany({ where: { residentId: r.id, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: at } }, data: { status: 'skipped', autoClosed: 'absence', completedAt: new Date(), completedById: null } })).count
        // Zeitgebundene Routine vor der Abwesenheit lässt sich nicht mehr nachholen: «nicht erledigt – übergeben»
        tasks.expired = (await tx.task.updateMany({ where: { residentId: r.id, status: { in: [...OPEN_STATUSES] }, dueAt: { lt: at }, source: { in: ['careplan', 'medication', 'recurring'] }, NOT: { sourceId: { startsWith: 'eval:' } } }, data: { status: 'skipped', autoClosed: 'shift_end', completedAt: new Date(), completedById: null } })).count
        break
      case 'return':
        await tx.careEpisode.updateMany({ where: { residentId: r.id, end: null, kind: 'absence' }, data: { end: at } })
        tasks.resumed = (await tx.task.updateMany({ where: { residentId: r.id, autoClosed: 'absence', status: 'skipped', dueAt: { gte: at } }, data: { status: 'planned', autoClosed: null, completedAt: null, completedById: null } })).count
        break
      case 'discharge':
        tasks.removed = (await tx.task.deleteMany({ where: { residentId: r.id, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: at }, completedAt: null } })).count
        await tx.careEpisode.updateMany({ where: { residentId: r.id, end: null }, data: { end: at } })
        break
    }
  })
  const after = await db.resident.findUniqueOrThrow({ where: { id: r.id }, include: { unit: { select: { id: true, name: true } }, room: { select: { number: true } } } })
  await actor.audit({
    action: 'adt.' + e.event, entityType: 'Resident', entityId: r.id, before,
    after: { status: after.status, unitId: after.unitId, roomId: after.roomId, dischargedAt: after.dischargedAt, at, ...('reason' in e && e.reason ? { reason: e.reason } : {}), ...(expectedEnd ? { expectedReturn: expectedEnd } : {}) },
    context: { residentId: r.id, via: actor.via ?? 'api', tasks },
  })
  for (const unitId of new Set([before.unitId, after.unitId])) {
    await emit({ orgId: actor.orgId, type: 'resident.updated', unitId, residentId: r.id, actorId: actor.actorId, payload: { adt: e.event, via: actor.via ?? 'api' } })
    invalidateTaskGeneration(unitId)
  }
  return after
}

/** Laufende Abwesenheit (Episode) einer Person, für Banner, Liste, Übergabe. */
export async function openAbsences(residentIds: string[]) {
  if (!residentIds.length) return new Map<string, { start: Date; reason: string; expectedEnd: Date | null }>()
  const rows = await db.careEpisode.findMany({ where: { residentId: { in: residentIds }, kind: 'absence', end: null }, orderBy: { start: 'desc' }, select: { residentId: true, start: true, reason: true, expectedEnd: true } })
  const m = new Map<string, { start: Date; reason: string; expectedEnd: Date | null }>()
  for (const x of rows) if (!m.has(x.residentId)) m.set(x.residentId, x)
  return m
}
