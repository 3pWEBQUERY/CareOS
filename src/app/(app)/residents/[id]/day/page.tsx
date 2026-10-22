import { db } from '@/lib/db'
import { ensureTasksForDay, taskView } from '@/lib/tasks'
import { taskTitle } from '@/lib/task-title'
import { addDays, fmtDayMonth, hm, startOfDay } from '@/lib/time'
import { pageResident, residentName, taskCategory, TASK_CATEGORIES, userNames, residentTitle } from '../../_lib/resident'
import { DayPlan, type DayTask } from './DayPlan'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'day')
}

export default async function DayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ctx, r, can } = await pageResident(id)
  const { t } = ctx
  if (!can('task.read')) return <div className="alert warn"><span className="grow">{t('common.notAllowed')}</span></div>
  const now = new Date()
  await ensureTasksForDay(r.unitId, now)
  const tasks = await db.task.findMany({
    where: { residentId: r.id, dueAt: { gte: startOfDay(now), lt: addDays(startOfDay(now), 1) } },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
  })
  const names = await userNames(ctx, tasks.map((k) => k.completedById))
  const rows: DayTask[] = tasks.map((k) => {
    const cat = taskCategory(t, k.category)
    return {
      id: k.id,
      time: hm(k.dueAt),
      due: k.dueAt.toISOString(),
      title: taskTitle(t, k),
      description: k.description,
      category: cat.label,
      tone: cat.tone,
      min: k.durationMin,
      status: k.status,
      view: taskView(k, now),
      source: k.source,
      at: k.completedAt ? hm(k.completedAt) : null,
      by: k.completedById ? names.get(k.completedById)?.short ?? null : null,
      note: k.note,
    }
  })
  return (
    <DayPlan
      residentId={r.id}
      who={`${residentName(r)} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`}
      tasks={rows}
      dateLabel={fmtDayMonth(now)}
      canComplete={can('task.complete')}
      canManage={can('task.manage')}
      now={now.toISOString()}
      me={`${ctx.user.firstName.charAt(0)}. ${ctx.user.lastName}`}
      categories={TASK_CATEGORIES.filter((c) => c.key !== 'assessment' && c.key !== 'quality' && c.key !== 'medication').map((c) => ({ value: c.value, label: t('chart.taskCat.' + c.key) }))}
    />
  )
}
