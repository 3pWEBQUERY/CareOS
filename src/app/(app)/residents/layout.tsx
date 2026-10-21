import { Suspense } from 'react'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { ResidentList, Workspace, type ResRow } from '@/components/residents/ResidentList'
import { ensureTasksForDay, OPEN_STATUSES } from '@/lib/tasks'
import { lastShiftEnd } from '@/lib/shift'
import { addDays, addMinutes, age, startOfDay } from '@/lib/time'

export default async function ResidentsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('resident.read')) return <Forbidden text={t('common.notAllowed')} />
  const unitIds = ctx.unit ? [ctx.unit.id] : ctx.unitIds
  if (ctx.unit) await ensureTasksForDay(ctx.unit.id)
  const now = new Date()
  const last = await lastShiftEnd(ctx.user.id, ctx.sessionId, now)
  const residents = await db.resident.findMany({
    where: { orgId: ctx.org.id, unitId: { in: unitIds }, status: { in: ['active', 'absent'] } },
    include: { room: true },
    orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }],
  })
  const ids = residents.map((r) => r.id)
  const [open, over, changed] = await Promise.all([
    db.task.groupBy({ by: ['residentId'], where: { residentId: { in: ids }, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addDays(startOfDay(now), 1) } }, _count: true }),
    db.task.groupBy({ by: ['residentId'], where: { residentId: { in: ids }, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addMinutes(now, -15) } }, _count: true }),
    db.observation.groupBy({ by: ['residentId'], where: { residentId: { in: ids }, at: { gte: last.at }, authorId: { not: ctx.user.id } }, _count: true }),
  ])
  const cnt = (rows: { residentId: string | null; _count: number }[], id: string) => rows.find((r) => r.residentId === id)?._count ?? 0
  const rows: ResRow[] = residents.map((r) => ({
    id: r.id,
    room: r.room?.number ?? '–',
    name: `${r.lastName} ${r.firstName}`,
    meta: [`${age(r.birthDate)} ${t('common.years')}`, r.careLevel != null && `${t('residents.banner.careLevel')} ${r.careLevel}`, r.allergies.length && t('residents.list.allergy'), r.rea === 'no' && t('residents.list.reaNo'), r.status === 'absent' && t('residents.banner.absent')].filter(Boolean).join(' · '),
    over: cnt(over, r.id),
    open: cnt(open, r.id),
    changed: cnt(changed, r.id) > 0,
    search: `${r.lastName} ${r.firstName} ${r.room?.number ?? ''}`.toLowerCase(),
  }))
  return (
    <Workspace>
      <Suspense>
        <ResidentList rows={rows} />
      </Suspense>
      {children}
    </Workspace>
  )
}
