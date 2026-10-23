import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/context'
import { db } from '@/lib/db'
import { searchFunctions } from '@/lib/search-functions'
import { snippet } from '@/lib/search-snippet'
import { fmtDate, fmtDayMonth, hm, sameDay } from '@/lib/time'
import { taskTitle } from '@/lib/task-title'
import { dedupeTaskHits, systemTaskMatches } from '@/lib/task-search'
import { OPEN_STATUSES } from '@/lib/tasks'
import { canModerate, liveFilter, myRoleKeys, postAudienceWhere, visibleChannels } from '@/app/(app)/team/lib'

/** Globale Suche, berechtigungsabhängig (PRD §24). Jede Quelle ist begrenzt, Suche ohne Gross-/Kleinschreibung. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100)
  if (q.length < 2) return NextResponse.json({ items: [] })
  const { t } = ctx
  const like = { contains: q, mode: 'insensitive' as const }
  const items: { group: string; label: string; hint?: string; href: string }[] = []
  const canClinicalChat = ctx.can('chat.clinical')

  const [residents, docs, people, tasks, posts, messages, interventions, forms, incidents] = await Promise.all([
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
      ? (() => {
          // Systemaufgaben über ihren übersetzten Titel bzw. ihre Kategorie finden (Titel sind Schlüssel, siehe taskTitle)
          const sys = systemTaskMatches(t, q)
          return db.task.findMany({
            where: {
              unitId: { in: ctx.unitIds },
              dueAt: { gte: new Date(Date.now() - 864e5) },
              status: { in: [...OPEN_STATUSES] },
              // Medikamentenaufgaben nur für Personen, die abgeben dürfen (wie in der Aufgabenliste)
              ...(ctx.can('resident.medication.administer') ? {} : { source: { not: 'medication' as const } }),
              OR: [
                { title: like },
                ...(sys.titles.length ? [{ title: { in: sys.titles } }] : []),
                ...sys.titles.map((x) => ({ title: { startsWith: x + ':' } })),
                ...sys.prefixes.map((x) => ({ title: { startsWith: x } })),
                ...(sys.categories.length ? [{ category: { in: sys.categories } }] : []),
              ],
            },
            include: { resident: { select: { firstName: true, lastName: true } } },
            take: 60,
            orderBy: { dueAt: 'asc' },
          })
        })()
      : [],
    // Mitteilungen nur aus Kanälen, die die Person sehen darf
    ctx.can('team.read')
      ? Promise.all([visibleChannels(ctx), myRoleKeys(ctx.user.id)]).then(([chs, keys]) =>
          db.post.findMany({
            // Zielgruppe der Mitteilung (Rollen) beachten
            where: { channelId: { in: chs.map((c) => c.id) }, AND: [liveFilter(), postAudienceWhere(ctx, keys, chs.filter((c) => canModerate(ctx, c)).map((c) => c.id)), { OR: [{ title: like }, { body: like }] }] },
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
          take: 15,
        })
      : [],
    ctx.can('admin.config') || ctx.can('resident.chart.write')
      ? db.formDefinition.findMany({ where: { orgId: ctx.org.id, name: like, ...(ctx.can('admin.config') ? {} : { active: true }) }, take: 4, orderBy: { name: 'asc' } })
      : [],
    // Ereignisse (z. B. «Sturz»): nur Art, Person und Datum im Treffer – keine Beschreibung
    ctx.can('quality.report')
      ? db.incident.findMany({
          where: { orgId: ctx.org.id, unitId: { in: ctx.unitIds }, OR: [{ type: { name: like } }, { description: like }] },
          include: { type: { select: { name: true } }, resident: { select: { firstName: true, lastName: true } } },
          orderBy: { occurredAt: 'desc' },
          take: 5,
        })
      : [],
  ])
  for (const r of residents) items.push({ group: t('common.palette.groupResident'), label: `${r.lastName} ${r.firstName}`, hint: [r.room?.number && t('common.palette.room', { n: r.room.number }), r.unit.name].filter(Boolean).join(' · '), href: `/residents/${r.id}` })
  for (const d of docs) items.push({ group: t('common.palette.groupDocument'), label: d.title, hint: d.currentVersion ? 'v' + d.currentVersion : undefined, href: `/docs/${d.id}` })
  for (const f of forms) items.push({ group: t('common.palette.groupForm'), label: f.name, hint: f.active ? undefined : t('admin.config.inactive'), href: ctx.can('admin.config') ? `/admin/forms/${f.id}` : '/residents?pick=notes' })
  for (const p of people) items.push({ group: t('common.palette.groupPerson'), label: `${p.firstName} ${p.lastName}`, hint: p.jobTitle ?? undefined, href: ctx.can('team.read') ? `/team/people/${p.id}` : `/chat?with=${p.id}` })
  // Gleiche Aufgabe je Person nur einmal (z. B. Medikamente 08:00, 12:00, 17:00 → ein Treffer mit nächster Zeit)
  const taskHits = dedupeTaskHits(tasks.map((k) => ({ ...k, label: taskTitle(t, k) })), 6)
  for (const { row: k, n } of taskHits) {
    const when = sameDay(k.dueAt, new Date()) ? hm(k.dueAt) : `${fmtDayMonth(k.dueAt, ctx.locale)} ${hm(k.dueAt)}`
    items.push({
      group: t('common.palette.groupTask'), label: k.label,
      hint: [k.resident ? `${k.resident.lastName} ${k.resident.firstName}` : t('tasks.noResident'), when, n > 1 ? t('tasks.search.times', { n }) : null].filter(Boolean).join(' · '),
      href: !k.residentId ? '/tasks' : k.title === 'medication.slot' ? `/residents/${k.residentId}/meds` : `/residents/${k.residentId}/day`,
    })
  }
  const seenIv = new Set<string>()
  for (const i of interventions) if (seenIv.size < 5 && !seenIv.has(i.resident.id + i.title) && seenIv.add(i.resident.id + i.title)) items.push({ group: t('common.palette.groupIntervention'), label: i.title, hint: `${i.resident.lastName} ${i.resident.firstName}`, href: `/residents/${i.resident.id}/careplan` })
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
  for (const i of incidents) {
    items.push({
      group: t('common.palette.groupIncident'),
      label: [i.type.name, i.resident && ctx.can('resident.read') ? `${i.resident.lastName} ${i.resident.firstName}` : null].filter(Boolean).join(' · '),
      hint: fmtDate(i.occurredAt, ctx.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      href: `/quality/${i.id}`,
    })
  }
  for (const f of searchFunctions(ctx, q)) items.push({ group: t('common.palette.groupFunction'), ...f })
  return NextResponse.json({ items })
}
