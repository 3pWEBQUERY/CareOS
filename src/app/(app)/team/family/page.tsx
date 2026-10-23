import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { fmtRel, hm, fmtDayMonth } from '@/lib/time'
import { portalEnabled } from '@/lib/portal/module'
import { isSelfAccess } from '@/lib/portal/policy'
import { FamilyHead, ModuleOff } from './Head'
import { familyUnits, inboxUnitIds, staffName } from './lib'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('portal.team.title') }
}

const FILTERS = ['open', 'mine', 'done'] as const
type Filter = (typeof FILTERS)[number]

/** Posteingang: Nachrichten und Besuchsanfragen von Angehörigen und aus dem Bewohnerportal, je Bereich, zuweisen und beantworten. */
export default async function FamilyInbox({ searchParams }: { searchParams: Promise<{ f?: string; all?: string }> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!portalEnabled(ctx.org)) return <ModuleOff ctx={ctx} />
  if (!ctx.can('portal.respond')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const f: Filter = (FILTERS as readonly string[]).includes(sp.f ?? '') ? (sp.f as Filter) : 'open'
  const all = sp.all === '1'
  const unitIds = inboxUnitIds(ctx, all)
  const units = familyUnits(ctx)
  const now = new Date()
  const res = { orgId: ctx.org.id, unitId: { in: unitIds } }
  const threadWhere = f === 'done' ? { status: 'closed' } : f === 'mine' ? { status: { not: 'closed' }, assigneeId: ctx.user.id } : { status: { not: 'closed' } }
  const visitWhere = f === 'done'
    ? { OR: [{ status: { in: ['declined', 'cancelled'] } }, { status: 'confirmed', end: { lt: now } }] }
    : f === 'mine'
      ? { assigneeId: ctx.user.id, OR: [{ status: 'requested' }, { status: 'confirmed', end: { gte: now } }] }
      : { OR: [{ status: 'requested' }, { status: 'confirmed', end: { gte: now } }] }
  const [threads, visits, openThreads, openVisits] = await Promise.all([
    db.portalThread.findMany({
      where: { orgId: ctx.org.id, resident: res, ...threadWhere },
      include: { resident: { select: { firstName: true, lastName: true, room: { select: { number: true } }, unit: { select: { name: true } } } }, access: { select: { inviteName: true, role: true, account: { select: { name: true } } } }, messages: { select: { side: true, body: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    }),
    db.visitRequest.findMany({
      where: { orgId: ctx.org.id, resident: res, ...visitWhere },
      include: { resident: { select: { firstName: true, lastName: true, room: { select: { number: true } }, unit: { select: { name: true } } } }, access: { select: { inviteName: true, role: true, account: { select: { name: true } } } } },
      orderBy: { start: 'asc' },
      take: 100,
    }),
    db.portalThread.count({ where: { orgId: ctx.org.id, resident: res, status: 'open' } }),
    db.visitRequest.count({ where: { orgId: ctx.org.id, resident: res, status: 'requested' } }),
  ])
  const staffIds = [...new Set([...threads.map((x) => x.assigneeId), ...visits.map((x) => x.assigneeId)].filter((x): x is string => !!x))]
  const staff = new Map((await db.user.findMany({ where: { id: { in: staffIds }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, staffName(u)]))
  type Item = { key: string; href: string; at: Date; kind: 'message' | 'visit'; who: string; self: boolean; resident: string; title: string; excerpt?: string; status: string; tone: string; unread: boolean; assignee: string | null }
  const items: Item[] = [
    ...threads.map((th) => ({
      key: 'm' + th.id, href: `/team/family/m/${th.id}`, at: th.lastMessageAt, kind: 'message' as const,
      who: th.access?.account?.name ?? th.access?.inviteName ?? '–', self: isSelfAccess(th.access),
      resident: `${th.resident.lastName} ${th.resident.firstName}` + (th.resident.room ? ` · ${t('residents.banner.room')} ${th.resident.room.number}` : '') + (all || unitIds.length > 1 ? ` · ${th.resident.unit.name}` : ''),
      title: th.subject, excerpt: th.messages[0]?.body.slice(0, 160),
      status: t('portal.threadStatus.' + th.status), tone: th.status === 'open' ? 'accent' : th.status === 'answered' ? 'ok' : '',
      unread: th.status === 'open' && (!th.staffReadAt || th.staffReadAt < th.lastMessageAt), assignee: th.assigneeId ? staff.get(th.assigneeId) ?? null : null,
    })),
    ...visits.map((v) => ({
      key: 'v' + v.id, href: `/team/family/v/${v.id}`, at: v.createdAt, kind: 'visit' as const,
      who: v.access?.account?.name ?? v.access?.inviteName ?? '–', self: isSelfAccess(v.access),
      resident: `${v.resident.lastName} ${v.resident.firstName}` + (v.resident.room ? ` · ${t('residents.banner.room')} ${v.resident.room.number}` : '') + (all || unitIds.length > 1 ? ` · ${v.resident.unit.name}` : ''),
      title: t('portal.team.visitLine', { date: fmtDayMonth(v.start, locale), from: hm(v.start), to: hm(v.end), n: v.visitors }) + (v.visitorName ? ' · ' + t('residentPortal.team.visitorName', { name: v.visitorName }) : ''),
      excerpt: v.note ?? undefined,
      status: t('portal.visitStatus.' + v.status), tone: v.status === 'requested' ? 'accent' : v.status === 'confirmed' ? 'ok' : v.status === 'declined' ? 'warn' : '',
      unread: v.status === 'requested' && !v.staffReadAt, assignee: v.assigneeId ? staff.get(v.assigneeId) ?? null : null,
    })),
  ].sort((a, b) => (a.unread === b.unread ? b.at.getTime() - a.at.getTime() : a.unread ? -1 : 1))

  const q = (o: { f?: Filter; all?: boolean }) => {
    const s = new URLSearchParams()
    const ff = o.f ?? f
    if (ff !== 'open') s.set('f', ff)
    if (o.all ?? all) s.set('all', '1')
    const str = s.toString()
    return '/team/family' + (str ? '?' + str : '')
  }
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <FamilyHead ctx={ctx} tab="inbox" title={t('portal.team.title')} sub={t('portal.team.sub')} counts={{ inbox: openThreads + openVisits }} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <nav className="chips" aria-label={t('common.filter')}>
              {FILTERS.map((x) => <Link key={x} className="chip" scroll={false} href={q({ f: x })} aria-current={f === x ? 'page' : undefined}>{t('portal.team.filters.' + x)}</Link>)}
            </nav>
            {units.length > 1 && (
              <nav className="seg" aria-label={t('portal.team.scope')}>
                <Link href={q({ all: false })} aria-current={!all ? 'page' : undefined}>{ctx.unit?.name ?? t('portal.team.thisUnit')}</Link>
                <Link href={q({ all: true })} aria-current={all ? 'page' : undefined}>{t('portal.team.allUnits')}</Link>
              </nav>
            )}
          </div>
          {items.length ? (
            <section className="card" aria-label={t('portal.team.tabs.inbox')}>
              <ul className="list">
                {items.map((it) => (
                  <li key={it.key}>
                    <Link className={'li' + (it.unread ? ' unread' : '')} href={it.href} style={{ alignItems: 'flex-start' }}>
                      <div className="grow stack-sm" style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <span className={'tag ' + (it.kind === 'visit' ? 'violet' : 'outline')}>{t('portal.team.kind.' + it.kind)}</span>
                          <strong>{it.resident}</strong>
                          <span className="small muted">{t('portal.team.from', { name: it.who })}</span>
                          {it.self && <span className="tag accent">{t('residentPortal.team.self')}</span>}
                        </div>
                        <div style={{ fontWeight: it.unread ? 600 : 500 }}>{it.title}</div>
                        {it.excerpt && <p className="small fg2 portal-clamp" style={{ margin: 0 }}>{it.excerpt}</p>}
                      </div>
                      <div className="stack-sm" style={{ alignItems: 'flex-end', flex: 'none' }}>
                        <span className={'tag ' + it.tone}>{it.status}</span>
                        <span className="small muted mono">{rel(it.at)}</span>
                        <span className="small muted">{it.assignee ?? t('portal.team.unassigned')}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : <p className="empty"><strong>{t('portal.team.empty.' + f)}</strong></p>}
        </div>
      </div>
    </main>
  )
}
