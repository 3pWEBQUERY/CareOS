import { db } from '@/lib/db'
import { aiConfigured } from '@/lib/env'
import { fmtRel } from '@/lib/time'
import { OBS_CATEGORIES, OBS_TONE, pageResident, residentName, userNames, residentTitle } from '../../_lib/resident'
import { Notes, type NoteRow } from './Notes'
import { FormEntry } from '@/components/forms/FormEntry'
import { notesExtras } from './extras'
import { FocusSuggestions } from '@/components/forms/FocusSuggestions'
import { focusFor } from '../../_lib/focus'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'notes')
}

/** Verlauf seitenweise (PRD §66): neueste 100, «Mehr laden» je 100 weitere. */
const PAGE = 100

export default async function NotesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ n?: string }> }) {
  const { id } = await params
  const limit = Math.min(5000, Math.max(PAGE, Math.ceil((Number((await searchParams).n) || PAGE) / PAGE) * PAGE))
  const { ctx, r, can } = await pageResident(id)
  const { t } = ctx
  const now = new Date()
  const page = await db.observation.findMany({
    where: { residentId: r.id },
    orderBy: [{ at: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: { correctedBy: { select: { id: true, authorId: true, createdAt: true } } },
  })
  const more = page.length > limit
  const obs = more ? page.slice(0, limit) : page
  const [names, asked] = await Promise.all([
    userNames(ctx, [...obs.map((o) => o.authorId), ...obs.flatMap((o) => o.correctedBy.map((c) => c.authorId))]),
    // Bereits für die Visite vorgemerkte Einträge (offene Fragen mit Bezug auf einen Verlaufseintrag)
    db.visitQuestion.findMany({ where: { orgId: ctx.org.id, residentId: r.id, status: 'open', refType: 'observation' }, select: { refId: true } }),
  ])
  const askedIds = new Set(asked.map((q) => q.refId))
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, ctx.locale)
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
      offline: !!(o.structured as { offline?: unknown } | null)?.offline,
      visitAsked: askedIds.has(o.id),
    }
  })
  const aiOn = aiConfigured() && can('ai.use')
  const extras = await notesExtras(ctx, obs, canWrite)
  for (const row of rows) Object.assign(row, extras.row(row.id))
  // Fokusdokumentation automatisch anbieten (PRD §10.3)
  const focus = canWrite ? await focusFor(ctx, r) : null
  return (
    <>
    {focus && focus.suggestions.length > 0 && <FocusSuggestions items={focus.suggestions} />}
    <Notes
      residentId={r.id}
      who={`${residentName(r)} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`}
      me={`${ctx.user.firstName.charAt(0)}. ${ctx.user.lastName}`}
      notes={rows}
      categories={OBS_CATEGORIES.map((c) => ({ key: c, label: t('chart.cat.' + c), tone: OBS_TONE[c] }))}
      canWrite={canWrite}
      aiOn={aiOn}
      moreHref={more ? `/residents/${r.id}/notes?n=${limit + PAGE}` : null}
      formSlot={extras.forms.length ? <FormEntry residentId={r.id} who={`${residentName(r)} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`} forms={extras.forms} /> : null}
    />
    </>
  )
}
