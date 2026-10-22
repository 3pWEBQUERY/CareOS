import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { IconPlus } from '@/components/icons'
import { addDays, dbDate, fmtDayMonth, fmtRel, fromDbDate, hm, startOfDay, weekdayShort } from '@/lib/time'
import { canModerate, canPostTo, channelAudience, channelLabel, liveFilter, myRoleKeys, visibleChannels } from './lib'
import { ackPostAction, archiveChannelAction } from './actions'
import { ActButton } from './_ui/ActButton'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('nav.team') }
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ ch?: string }> }) {
  const ctx = await getCtx()
  const { t, user, locale, unit } = ctx
  if (!ctx.can('team.read')) return <Forbidden text={t('common.notAllowed')} />
  const { ch: chParam } = await searchParams
  const now = new Date()
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)

  const [channels, roleKeys] = await Promise.all([visibleChannels(ctx), myRoleKeys(user.id)])
  const active = channels.find((c) => c.id === chParam) ?? null
  const chIds = active ? [active.id] : channels.map((c) => c.id)
  const byId = new Map(channels.map((c) => [c.id, c]))
  const postable = channels.filter((c) => canPostTo(ctx, c, roleKeys))
  const moderator = canModerate(ctx)

  const [posts, events, ackPosts, nextShifts, openShifts, trainings, docs, location, allChannels] = await Promise.all([
    db.post.findMany({
      where: { channelId: { in: chIds }, ...liveFilter(now) },
      include: { author: { select: { firstName: true, lastName: true } }, _count: { select: { comments: true } } },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take: 60,
    }),
    db.post.findMany({ where: { channelId: { in: channels.map((c) => c.id) }, eventAt: { gte: startOfDay(now) }, ...liveFilter(now) }, orderBy: { eventAt: 'asc' }, take: 5 }),
    db.post.findMany({
      where: { channelId: { in: channels.map((c) => c.id) }, requireAck: true, ...liveFilter(now) },
      select: { id: true, title: true, body: true, channelId: true, authorId: true, important: true, publishedAt: true, fileIds: true, author: { select: { firstName: true, lastName: true } } },
      orderBy: { publishedAt: 'desc' },
    }),
    ctx.can('schedule.read')
      ? db.shift.findMany({ where: { userId: user.id, date: { gte: dbDate(now), lte: dbDate(addDays(now, 14)) }, status: { not: 'cancelled' } }, include: { shiftType: true }, orderBy: { date: 'asc' }, take: 5 })
      : [],
    ctx.can('schedule.read') && unit ? db.shift.count({ where: { unitId: unit.id, status: 'open', date: { gte: dbDate(now) } } }) : 0,
    ctx.can('learn.read') ? db.enrollment.count({ where: { userId: user.id, status: { in: ['assigned', 'in_progress', 'expired'] } } }) : 0,
    ctx.can('docs.read') ? db.document.findMany({ where: { orgId: ctx.org.id, status: 'approved', updatedAt: { gte: addDays(now, -21) } }, orderBy: { updatedAt: 'desc' }, take: 5 }) : [],
    unit ? db.location.findUnique({ where: { id: unit.locationId } }) : null,
    moderator ? visibleChannels(ctx, { includeArchived: true }) : Promise.resolve([]),
  ])

  const postIds = [...new Set([...posts.map((p) => p.id), ...ackPosts.map((p) => p.id)])]
  const acks = await db.acknowledgement.findMany({ where: { subjectType: 'post', subjectId: { in: postIds } }, select: { userId: true, subjectId: true } })
  const mine = new Set(acks.filter((a) => a.userId === user.id).map((a) => a.subjectId))
  const toAck = ackPosts.filter((p) => !mine.has(p.id) && p.authorId !== user.id)
  const toAckIds = new Set(toAck.map((p) => p.id))

  // Bestätigungsstand nur für Verfassende und Moderation (PRD §17.3)
  const statsFor = posts.filter((p) => p.requireAck && (p.authorId === user.id || canModerate(ctx, byId.get(p.channelId))))
  const audiences = new Map<string, Set<string>>()
  for (const chId of new Set(statsFor.map((p) => p.channelId))) audiences.set(chId, new Set((await channelAudience(ctx.org.id, byId.get(chId)!)).map((u) => u.id)))
  const ackStat = (p: (typeof posts)[number]) => {
    const aud = audiences.get(p.channelId)
    if (!aud || !statsFor.includes(p)) return null
    const others = [...aud].filter((id) => id !== p.authorId)
    return { n: acks.filter((a) => a.subjectId === p.id && a.userId !== p.authorId && aud.has(a.userId)).length, total: others.length }
  }

  const recent = addDays(now, -14)
  // Offene Lesebestätigungen stehen zuoberst in «Bitte lesen und bestätigen» (PRD §4.3, §17.3) und nicht doppelt im Feed.
  const top = posts.filter((p) => !toAckIds.has(p.id) && (p.pinned || (p.important && p.publishedAt >= recent)))
  const rest = posts.filter((p) => !toAckIds.has(p.id) && !top.includes(p))
  /** Kurze Mitteilungen ohne Anhang werden vollständig gezeigt und lassen sich direkt bestätigen (ein Tipp). */
  const INLINE_MAX = 700

  const PostRow = ({ p }: { p: (typeof posts)[number] }) => {
    const ch = byId.get(p.channelId)!
    const st = ackStat(p)
    const excerpt = p.body.length > 240 ? p.body.slice(0, 238) + ' …' : p.body
    return (
      <li>
        <Link className="li" href={`/team/post/${p.id}`} style={{ flexDirection: 'column', gap: 4 }}>
          <div className="row" style={{ gap: 6, width: '100%' }}>
            <span className="lbl">{channelLabel(t, ch, channels)}</span>
            {p.pinned && <span className="tag outline">{t('team.feed.pinned')}</span>}
            {p.important && <span className="tag warn">{t('team.feed.important')}</span>}
            {p.requireAck && p.authorId !== user.id && (mine.has(p.id) ? <span className="tag ok">✓ {t('team.feed.acked')}</span> : <span className="tag crit">{t('team.feed.ackPending')}</span>)}
            {p.eventAt && <span className="tag accent">{t('team.feed.event')} {fmtDayMonth(p.eventAt)} {hm(p.eventAt)}</span>}
            <span className="small muted mono" style={{ marginLeft: 'auto' }}>{rel(p.publishedAt)}</span>
          </div>
          <div style={{ fontWeight: 600 }}>{p.title}</div>
          <p className="small fg2" style={{ margin: 0, maxWidth: '80ch' }}>{excerpt}</p>
          <div className="row small muted" style={{ gap: 12 }}>
            <span>{p.author.firstName} {p.author.lastName}</span>
            {p._count.comments > 0 && <span>{t('team.feed.comments', { n: p._count.comments })}</span>}
            {p.fileIds.length > 0 && <span>{t('team.feed.attachments', { n: p.fileIds.length })}</span>}
            {p.eventPlace && <span>{p.eventPlace}</span>}
            {st && <span className={'pill ' + (st.n >= st.total ? 'ok' : 'warn')}>{t('team.feed.ackCount', { n: st.n, total: st.total })}</span>}
          </div>
        </Link>
      </li>
    )
  }

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{t('team.label')}</span>
          <h1>{active ? active.name : t('team.title')}</h1>
          <p className="sub">{active?.description ?? t('team.sub')}</p>
        </div>
        {postable.length > 0 && (
          <Link className="btn primary" href={`/team/new${active && postable.includes(active) ? `?ch=${active.id}` : ''}`}><IconPlus size={16} />{t('team.newPost')}</Link>
        )}
      </div>
      <div className="scroll">
        <div className="tabpanel">
          {toAck.length > 0 && (
            <section className="card warn team-ackq" aria-labelledby="ack" id="ack">
              <div className="card-head"><h2 id="ack">{t('team.ux.ackQueue')}</h2><span className="pill warn">{toAck.length}</span></div>
              <ul className="list">
                {toAck.map((p) => {
                  const inline = p.body.length <= INLINE_MAX && !p.fileIds.length
                  const ch = byId.get(p.channelId)
                  return (
                    <li key={p.id} className="team-ackq-item">
                      <div className="row" style={{ gap: 6 }}>
                        {ch && <span className="lbl">{channelLabel(t, ch, channels)}</span>}
                        {p.important && <span className="tag warn">{t('team.feed.important')}</span>}
                        <span className="small muted mono" style={{ marginLeft: 'auto' }}>{rel(p.publishedAt)}</span>
                      </div>
                      <h3 className="sub"><Link href={`/team/post/${p.id}`} className="team-ackq-title">{p.title}</Link></h3>
                      <p className="team-ackq-body">{inline ? p.body : p.body.slice(0, 238) + ' …'}</p>
                      <div className="row small muted" style={{ gap: 12 }}>
                        <span>{p.author.firstName} {p.author.lastName}</span>
                        {p.fileIds.length > 0 && <span>{t('team.feed.attachments', { n: p.fileIds.length })}</span>}
                      </div>
                      <div className="form-actions">
                        {inline ? (
                          <ActButton action={ackPostAction.bind(null, p.id)} className="btn primary">✓ {t('team.ack.button')}</ActButton>
                        ) : (
                          <Link className="btn primary" href={`/team/post/${p.id}`}>{t('team.ux.readAndAck')}</Link>
                        )}
                        {inline && <Link className="btn ghost" href={`/team/post/${p.id}`}>{t('team.ux.openPost')}</Link>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
          <div className="metrics metrics-sm2">
            <a className="metric" href={toAck.length ? '#ack' : '#feed'}><span className="lbl">{t('team.metrics.toAck')}</span><span className={'val' + (toAck.length ? ' warn' : '')}>{toAck.length}</span></a>
            {ctx.can('schedule.read') && <Link className="metric" href="/schedule?view=open"><span className="lbl">{t('team.metrics.openShifts')}</span><span className="val">{openShifts}</span></Link>}
            {ctx.can('learn.read') && <Link className="metric" href="/learn"><span className="lbl">{t('team.metrics.trainings')}</span><span className={'val' + (trainings ? ' warn' : '')}>{trainings}</span></Link>}
            {ctx.can('docs.read') && <Link className="metric" href="/docs"><span className="lbl">{t('team.metrics.newDocs')}</span><span className="val">{docs.length}</span></Link>}
          </div>

          <nav className="chips team-chips" aria-label={t('team.channels')}>
            <Link className="chip" href="/team" aria-current={!active ? 'page' : undefined}>{t('team.all')}</Link>
            {channels.map((c) => (
              <Link key={c.id} className="chip" href={`/team?ch=${c.id}`} aria-current={active?.id === c.id ? 'page' : undefined} title={c.name}>{channelLabel(t, c, channels)}</Link>
            ))}
          </nav>

          <div className="team-grid" id="feed">
            <div className="stack">
              {top.length > 0 && (
                <section className="card" aria-labelledby="top">
                  <div className="card-head"><h2 id="top">{t('team.feed.top')}</h2><span className="pill">{top.length}</span></div>
                  <ul className="list">{top.map((p) => <PostRow key={p.id} p={p} />)}</ul>
                </section>
              )}
              <section className="card" aria-labelledby="latest">
                <div className="card-head"><h2 id="latest">{t('team.feed.title')}</h2></div>
                {rest.length ? <ul className="list">{rest.map((p) => <PostRow key={p.id} p={p} />)}</ul> : <div className="card-body"><p className="empty" style={{ margin: 0 }}>{t(top.length || toAck.length ? 'team.feed.noMore' : 'team.feed.empty')}</p></div>}
              </section>
            </div>

            <aside className="stack">
              <section className="card" aria-labelledby="ev">
                <div className="card-head"><h2 id="ev">{t('team.side.events')}</h2></div>
                {events.length ? (
                  <ul className="list">
                    {events.map((e) => (
                      <li key={e.id}>
                        <Link className="li" href={`/team/post/${e.id}`}>
                          <span className="mono small" style={{ minWidth: 64 }}>{weekdayShort(e.eventAt!, locale)} {fmtDayMonth(e.eventAt!)}<br /><span className="muted">{hm(e.eventAt!)}</span></span>
                          <span className="grow"><span>{e.title}</span>{e.eventPlace && <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>{e.eventPlace}</span>}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('team.side.eventsNone')}</div>}
              </section>

              {ctx.can('schedule.read') && (
                <section className="card" aria-labelledby="sch">
                  <div className="card-head"><h2 id="sch">{t('team.side.schedule')}</h2><Link className="linkbtn small" href="/schedule">{t('team.side.toSchedule')} →</Link></div>
                  <div className="card-body stack-sm">
                    <span className="lbl">{t('team.side.nextShifts')}</span>
                    {nextShifts.length ? (
                      <div className="chips">
                        {nextShifts.map((s) => {
                          const d = fromDbDate(s.date)
                          return <span key={s.id} className="chip"><span className={'sh ' + s.shiftType.code} style={{ marginRight: 6 }}>{s.shiftType.code}</span>{weekdayShort(d, locale)} {fmtDayMonth(d)}</span>
                        })}
                      </div>
                    ) : <span className="small muted">{t('team.side.nextShiftsNone')}</span>}
                    {unit && openShifts > 0 && <Link className="linkbtn small" href="/schedule?view=open">{t('team.side.openShifts', { n: openShifts, unit: unit.name })}</Link>}
                  </div>
                </section>
              )}

              {ctx.can('docs.read') && (
                <section className="card" aria-labelledby="docs">
                  <div className="card-head"><h2 id="docs">{t('team.side.docs')}</h2></div>
                  {docs.length ? (
                    <ul className="list">
                      {docs.map((d) => <li key={d.id}><Link className="li" href={`/docs/${d.id}`}><span className="grow">{d.title}</span>{d.currentVersion && <span className="mono small muted">v{d.currentVersion}</span>}</Link></li>)}
                    </ul>
                  ) : <div className="card-body small muted">{t('team.side.docsNone')}</div>}
                  {ctx.can('learn.read') && (
                    <div className="card-foot row-between small">
                      <span className={trainings ? 'warn-text' : 'muted'}>{trainings ? t('team.side.trainingsOpen', { n: trainings }) : t('team.side.trainingsNone')}</span>
                      <Link className="linkbtn small" href="/learn">{t('team.side.toLearn')} →</Link>
                    </div>
                  )}
                </section>
              )}

              {unit && location && (
                <section className="card" aria-labelledby="loc">
                  <div className="card-head"><h2 id="loc">{t('team.side.unitInfo')}</h2></div>
                  <div className="card-body">
                    <dl className="kv">
                      <dt>{t('team.kinds.location')}</dt><dd>{location.name}</dd>
                      {location.address && <><dt>{t('team.side.address')}</dt><dd>{location.address}</dd></>}
                      {location.phone && <><dt>{t('team.side.phone')}</dt><dd className="mono">{location.phone}</dd></>}
                      <dt>{t('team.kinds.unit')}</dt><dd>{unit.name}</dd>
                    </dl>
                  </div>
                </section>
              )}

              {moderator && (
                <section className="card" aria-labelledby="mod">
                  <div className="card-head"><h2 id="mod">{t('team.side.channels')}</h2></div>
                  <ul className="list">
                    {allChannels.map((c) => (
                      <li key={c.id} className="li" style={{ alignItems: 'center' }}>
                        <span className="grow"><span className={c.archived ? 'muted' : ''}>{c.name}</span> <span className="small muted" style={{ fontWeight: 400 }}>{t('team.kinds.' + c.kind)}</span></span>
                        {c.archived && <span className="tag">{t('team.side.archived')}</span>}
                        {canModerate(ctx, c) && (
                          <ActButton action={archiveChannelAction.bind(null, c.id, !c.archived)} className="btn sm ghost" confirm={c.archived ? undefined : t('team.side.archiveConfirm', { name: c.name })}>
                            {t(c.archived ? 'team.side.restore' : 'team.side.archive')}
                          </ActButton>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          </div>
        </div>
      </div>
    </main>
  )
}
