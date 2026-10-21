import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/context'
import { db } from '@/lib/db'

/** Globale Suche, berechtigungsabhängig (PRD §24). */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ items: [] })
  const { t } = ctx
  const like = { contains: q, mode: 'insensitive' as const }
  const items: { group: string; label: string; hint?: string; href: string }[] = []

  const [residents, docs, people, tasks] = await Promise.all([
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
  ])
  for (const r of residents) items.push({ group: t('common.palette.groupResident'), label: `${r.lastName} ${r.firstName}`, hint: [r.room?.number && `Zi. ${r.room.number}`, r.unit.name].filter(Boolean).join(' · '), href: `/residents/${r.id}` })
  for (const d of docs) items.push({ group: t('common.palette.groupDocument'), label: d.title, hint: d.currentVersion ? 'v' + d.currentVersion : undefined, href: `/docs/${d.id}` })
  for (const p of people) items.push({ group: t('common.palette.groupPerson'), label: `${p.firstName} ${p.lastName}`, hint: p.jobTitle ?? undefined, href: `/chat?with=${p.id}` })
  for (const k of tasks) items.push({ group: t('common.palette.groupTask'), label: k.title, hint: k.resident ? `${k.resident.lastName}` : undefined, href: k.residentId ? `/residents/${k.residentId}` : '/tasks' })
  return NextResponse.json({ items })
}
