import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { OPEN_STATUSES } from '@/lib/tasks'
import { addDays, hm, startOfDay } from '@/lib/time'
import { taskTitle } from '@/lib/task-title'
import { SnapshotSaver } from './SnapshotSaver'

/**
 * Lesestand für die Offline-Ansicht (PRD §39: «ausgewählte Informationen temporär sicher verfügbar»):
 * Personen des gewählten Bereichs mit Zimmer, Allergien, REA und Risiken sowie offene Aufgaben von heute.
 * Bewusst keine Verlaufseinträge und keine Vitalwerte. Verschlüsselt auf dem Gerät, höchstens 12 h gültig.
 */
export async function ShiftSnapshot() {
  const ctx = await getCtx()
  const { unit, t, user } = ctx
  if (!unit || !ctx.canHere('resident.read')) return null
  const now = new Date()
  const [residents, tasks] = await Promise.all([
    db.resident.findMany({
      where: { orgId: ctx.org.id, unitId: unit.id, status: { in: ['active', 'absent'] } },
      select: { id: true, firstName: true, lastName: true, allergies: true, rea: true, risks: true, status: true, room: { select: { number: true } } },
      orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }],
    }),
    ctx.canHere('task.read')
      ? db.task.findMany({
          where: { orgId: ctx.org.id, unitId: unit.id, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addDays(startOfDay(now), 1) } },
          select: { id: true, residentId: true, title: true, dueAt: true, source: true },
          orderBy: { dueAt: 'asc' },
          take: 400,
        })
      : [],
  ])
  return (
    <SnapshotSaver
      data={{
        userId: user.id,
        userName: `${user.firstName.charAt(0)}. ${user.lastName}`,
        locale: ctx.locale,
        unit: unit.name,
        residents: residents.map((r) => ({
          id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, allergies: r.allergies, rea: r.rea, risks: r.risks, absent: r.status === 'absent',
        })),
        tasks: tasks.map((k) => ({ id: k.id, residentId: k.residentId, time: hm(k.dueAt), title: taskTitle(t, k), med: k.source === 'medication' })),
      }}
    />
  )
}
