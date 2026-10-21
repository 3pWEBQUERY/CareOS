import 'server-only'
import type { Resident, Task } from '@prisma/client'
import { dateKey, fromDbDate } from '@/lib/time'
import type { TFn } from '@/i18n/core'
import { taskTitle } from '@/lib/task-title'

/** JSON-Abbildungen der REST API v1. Felder sind stabil; neue Felder werden nur ergänzt. */
export function residentJson(r: Resident & { unit?: { id: string; name: string } | null; room?: { number: string } | null }) {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    birthDate: dateKey(fromDbDate(r.birthDate)),
    sex: r.sex,
    status: r.status,
    unitId: r.unitId,
    unit: r.unit?.name ?? null,
    room: r.room?.number ?? null,
    careLevel: r.careLevel,
    rea: r.rea,
    allergies: r.allergies,
    admittedAt: r.admittedAt.toISOString(),
    dischargedAt: r.dischargedAt?.toISOString() ?? null,
  }
}

export function taskJson(k: Task, t: TFn) {
  return {
    id: k.id,
    unitId: k.unitId,
    residentId: k.residentId,
    title: taskTitle(t, k),
    titleKey: k.title,
    description: k.description,
    category: k.category,
    dueAt: k.dueAt.toISOString(),
    durationMin: k.durationMin,
    priority: k.priority,
    status: k.status,
    source: k.source,
    assigneeId: k.assigneeId,
    completedAt: k.completedAt?.toISOString() ?? null,
    completedById: k.completedById,
    note: k.note,
    createdAt: k.createdAt.toISOString(),
  }
}

/** Opaque Cursor: Zeitstempel + ID, base64url. */
export const encodeCursor = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url')
export function decodeCursor(c: string | null) {
  if (!c) return null
  try {
    const [iso, id] = Buffer.from(c, 'base64url').toString('utf8').split('|')
    const at = new Date(iso)
    return Number.isNaN(at.getTime()) || !id ? null : { at, id }
  } catch {
    return null
  }
}
