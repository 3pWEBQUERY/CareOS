import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { emit } from '@/lib/events'
import type { AuditEntry } from '@/lib/audit'
import { invalidateTaskGeneration, OPEN_STATUSES } from '@/lib/tasks'
import { dbDate, parseDateKey } from '@/lib/time'

/**
 * Patientenadministration (ADT) über die Schnittstelle (PRD §40, §41, §43): Eintritt, Verlegung, Abwesenheit
 * (z. B. Spitalaufenthalt), Rückkehr und Austritt. Jeder Vorgang wird protokolliert, als Domain Event verteilt
 * und als Pflegeepisode (CareEpisode) geführt. Akten werden nie gelöscht.
 */
export type AdtActor = { orgId: string; actorId: string; audit: (e: AuditEntry) => Promise<unknown> }
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
  z.object({ event: z.literal('leave'), at: when, reason: z.string().trim().min(1).max(200) }).strict(),
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
      status: 'active', admittedAt: at, nutrition: { create: {} }, episodes: { create: { start: at, reason: b.reason } },
    },
    include: { unit: { select: { id: true, name: true } }, room: { select: { number: true } } },
  })
  await actor.audit({ action: 'adt.admit', entityType: 'Resident', entityId: r.id, after: { unitId: r.unitId, roomId: r.roomId, admittedAt: at, reason: b.reason }, context: { residentId: r.id } })
  await emit({ orgId: actor.orgId, type: 'resident.updated', unitId: r.unitId, residentId: r.id, actorId: actor.actorId, payload: { adt: 'admit', via: 'api' } })
  invalidateTaskGeneration(r.unitId)
  return r
}

/** Offene, künftige Aufgaben einer Person entfernen (Austritt) – erledigte bleiben als Dokumentation erhalten. */
async function dropFutureTasks(residentId: string, from: Date) {
  return db.task.deleteMany({ where: { residentId, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: from }, completedAt: null } })
}

export async function adtEvent(actor: AdtActor, residentId: string, e: AdtEvent) {
  const r = await db.resident.findFirst({ where: { id: residentId, orgId: actor.orgId } })
  if (!r) throw new AdtError(404, 'not_found', 'Resident not found')
  if (r.status === 'discharged' || r.status === 'deceased') throw new AdtError(409, 'not_current', 'Resident is discharged')
  const at = atOrNow(e.at)
  const before = { status: r.status, unitId: r.unitId, roomId: r.roomId, dischargedAt: r.dischargedAt }
  let data: Parameters<typeof db.resident.update>[0]['data']
  switch (e.event) {
    case 'transfer':
      await unitOf(actor.orgId, e.unitId)
      if (e.roomId) await freeRoom(e.roomId, e.unitId, r.id)
      if (e.unitId === r.unitId && (e.roomId ?? null) === r.roomId) throw new AdtError(422, 'validation_failed', 'No change')
      data = { unitId: e.unitId, roomId: e.roomId ?? null }
      if (e.unitId !== r.unitId) await dropFutureTasks(r.id, at)
      break
    case 'leave':
      if (r.status === 'absent') throw new AdtError(409, 'conflict', 'Resident is already absent')
      data = { status: 'absent' }
      break
    case 'return':
      if (r.status !== 'absent') throw new AdtError(409, 'conflict', 'Resident is not absent')
      if (e.roomId) await freeRoom(e.roomId, r.unitId, r.id)
      data = { status: 'active', ...(e.roomId ? { roomId: e.roomId } : {}) }
      break
    case 'discharge':
      data = { status: e.deceased ? 'deceased' : 'discharged', dischargedAt: at, roomId: null }
      await dropFutureTasks(r.id, at)
      await db.careEpisode.updateMany({ where: { residentId: r.id, end: null }, data: { end: at } })
      break
  }
  // Versionsprüfung: gleichzeitige Änderung in der App gewinnt nicht stillschweigend (PRD §32)
  const res = await db.resident.updateMany({ where: { id: r.id, updatedAt: r.updatedAt }, data })
  if (res.count !== 1) throw new AdtError(409, 'conflict', 'Resident was changed concurrently, retry')
  const after = await db.resident.findUniqueOrThrow({ where: { id: r.id }, include: { unit: { select: { id: true, name: true } }, room: { select: { number: true } } } })
  await actor.audit({ action: 'adt.' + e.event, entityType: 'Resident', entityId: r.id, before, after: { status: after.status, unitId: after.unitId, roomId: after.roomId, dischargedAt: after.dischargedAt, at, reason: 'reason' in e ? e.reason ?? null : null }, context: { residentId: r.id } })
  for (const unitId of new Set([before.unitId, after.unitId])) {
    await emit({ orgId: actor.orgId, type: 'resident.updated', unitId, residentId: r.id, actorId: actor.actorId, payload: { adt: e.event, via: 'api' } })
    invalidateTaskGeneration(unitId)
  }
  return after
}
