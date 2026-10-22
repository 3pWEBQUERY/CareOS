import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/context'
import { db } from '@/lib/db'
import { searchFunctions } from '@/lib/search-functions'
import { snippet } from '@/lib/search-snippet'
import { liveFilter, visibleChannels } from '@/app/(app)/team/lib'

/** Globale Suche, berechtigungsabhängig (PRD §24). Jede Quelle ist begrenzt, Suche ohne Gross-/Kleinschreibung. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100)
  if (q.length < 2) return NextResponse.json({ items: [] })
  const { t } = ctx
  const like = { contains: q, mode: 'insensitive' as const }
  const items: { group: string; label: string; hint?: string; href: string }[] = []
  const canClinicalChat = ctx.can('chat.clinical')

  const [residents, docs, people, tasks, posts, messages, interventions, forms] = await Promise.all([
    ctx.can('resident.read')
      ? db.resident.findMany({
          where: { orgId: ctx.org.id, unitId: { in: ctx.unitIds }, OR: [{ lastName: like }, { firstName: like }, { room: { number: { startsWith: q } } }] },
          include: { room: true, unit: true },
          take: 8,
        })
      : [],
    ctx.can('docs.read')
      ? db.document.findMany({ where: { orgId: ctx.org.id, status: 'approved', OR: [{ title: like }, { tags: { has: q.toLowerCase() } }, { versions: { some: { body: like } } }] }, take: 8 })
      : [],
    db.user.findMany({ where: { orgId: ctx.org.id, active: true, OR: [{ lastName: like }, { firstName: like }] }, take: 6 }),
    ctx.can('task.read')
      ? db.task.findMany({ where: { unitId: { in: ctx.unitIds }, title: like, dueAt: { gte: new Date(Date.now() - 864e5) } }, include: { resident: true }, take: 6, orderBy: { dueAt: 'asc' } })
      : [],
    // Mitteilungen nur aus Kanälen, die die Person sehen darf
    ctx.can('team.read')
      ? visibleChannels(ctx).then((chs) =>
          db.post.findMany({
            where: { channelId: { in: chs.map((c) => c.id) }, AND: [liveFilter(), { OR: [{ title: like }, { body: like }] }] },
            include: { channel: { select: { name: true } } },
            orderBy: { publishedAt: 'desc' },
            take: 5,
          }),
        )
      : [],
    // Chat: nur Unterhaltungen, in denen die Person Mitglied ist; klinische nur mit chat.clinical
    ctx.can('chat.use')
      ? db.message.findMany({
          where: {
            body: like,
            deletedAt: null,
            conversation: { orgId: ctx.org.id, members: { some: { userId: ctx.user.id } }, ...(canClinicalChat ? {} : { clinical: false }) },
          },
          include: {
            author: { select: { firstName: true, lastName: true } },
            conversation: { select: { id: true, kind: true, name: true, clinical: true, members: { select: { userId: true, user: { select: { firstName: true, lastName: true } } }, take: 3 } } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
      : [],
    ctx.can('resident.read')
      ? db.intervention.findMany({
          where: { active: true, title: like, resident: { orgId: ctx.org.id, unitId: { in: ctx.unitIds }, status: { in: ['active', 'absent'] } } },
          include: { resident: { select: { id: true, firstName: true, lastName: true } } },
          take: 5,
        })
      : [],
    ctx.can('admin.config') || ctx.can('resident.chart.write')
      ? db.formDefinition.findMany({ where: { orgId: ctx.org.id, name: like, ...(ctx.can('admin.config') ? {} : { active: true }) }, take: 4, orderBy: { name: 'asc' } })
      : [],
  ])
  for (const r of residents) items.push({ group: t('common.palette.groupResident'), label: `${r.lastName} ${r.firstName}`, hint: [r.room?.number && `Zi. ${r.room.number}`, r.unit.name].filter(Boolean).join(' · '), href: `/residents/${r.id}` })
  for (const d of docs) items.push({ group: t('common.palette.groupDocument'), label: d.title, hint: d.currentVersion ? 'v' + d.currentVersion : undefined, href: `/docs/${d.id}` })
  for (const f of forms) items.push({ group: t('common.palette.groupForm'), label: f.name, hint: f.active ? undefined : t('admin.config.inactive'), href: ctx.can('admin.config') ? `/admin/forms/${f.id}` : '/residents?pick=notes' })
  for (const p of people) items.push({ group: t('common.palette.groupPerson'), label: `${p.firstName} ${p.lastName}`, hint: p.jobTitle ?? undefined, href: `/chat?with=${p.id}` })
  for (const k of tasks) items.push({ group: t('common.palette.groupTask'), label: k.title, hint: k.resident ? `${k.resident.lastName}` : undefined, href: k.residentId ? `/residents/${k.residentId}` : '/tasks' })
  for (const i of interventions) items.push({ group: t('common.palette.groupIntervention'), label: i.title, hint: `${i.resident.lastName} ${i.resident.firstName}`, href: `/residents/${i.resident.id}/careplan` })
  for (const p of posts) items.push({ group: t('common.palette.groupPost'), label: p.title, hint: p.title.toLowerCase().includes(q.toLowerCase()) ? p.channel.name : snippet(p.body, q, 60), href: `/team/post/${p.id}` })
  for (const m of messages) {
    const c = m.conversation
    const other = c.members.find((x) => x.userId !== ctx.user.id)?.user
    const title = c.name || (other ? `${other.firstName} ${other.lastName}` : t('common.palette.groupMessage'))
    items.push({
      group: t('common.palette.groupMessage'),
      label: `${m.author.firstName}: ${snippet(m.body, q, 70)}`,
      hint: c.clinical ? `${title} · ${t('team.chat.clinical')}` : title,
      href: `/chat?c=${c.id}`,
    })
  }
  for (const f of searchFunctions(ctx, q)) items.push({ group: t('common.palette.groupFunction'), ...f })
  return NextResponse.json({ items })
}
