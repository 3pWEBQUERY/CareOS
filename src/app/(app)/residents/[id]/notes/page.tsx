import { db } from '@/lib/db'
import { aiConfigured } from '@/lib/env'
import { fmtRel } from '@/lib/time'
import { OBS_CATEGORIES, OBS_TONE, pageResident, residentName, userNames } from '../../_lib/resident'
import { Notes, type NoteRow } from './Notes'

export default async function NotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ctx, r, can } = await pageResident(id)
  const { t } = ctx
  const now = new Date()
  const obs = await db.observation.findMany({
    where: { residentId: r.id },
    orderBy: [{ at: 'desc' }, { createdAt: 'desc' }],
    take: 300,
    include: { correctedBy: { select: { id: true, authorId: true, createdAt: true } } },
  })
  const names = await userNames(ctx, [...obs.map((o) => o.authorId), ...obs.flatMap((o) => o.correctedBy.map((c) => c.authorId))])
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)
  const canCorrectAll = can('resident.chart.correct')
  const canWrite = can('resident.chart.write')
  const rows: NoteRow[] = obs.map((o) => {
    const corr = o.correctedBy[0]
    return {
      id: o.id,
      at: o.at.toISOString(),
      rel: rel(o.at),
      category: o.category,
      text: o.text,
      author: names.get(o.authorId)?.full ?? '–',
      important: o.important,
      aiAssisted: o.aiAssisted,
      source: o.source,
      fromTask: !!o.taskId,
      supersedes: !!o.supersedesId,
      correctedBy: corr ? { by: names.get(corr.authorId)?.short ?? '–', at: rel(corr.createdAt) } : null,
      canCorrect: !corr && canWrite && (o.authorId === ctx.user.id || canCorrectAll),
    }
  })
  const aiOn = aiConfigured() && can('ai.use')
  return (
    <Notes
      residentId={r.id}
      who={`${residentName(r)} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`}
      me={`${ctx.user.firstName.charAt(0)}. ${ctx.user.lastName}`}
      notes={rows}
      categories={OBS_CATEGORIES.map((c) => ({ key: c, label: t('chart.cat.' + c), tone: OBS_TONE[c] }))}
      canWrite={canWrite}
      aiOn={aiOn}
    />
  )
}
