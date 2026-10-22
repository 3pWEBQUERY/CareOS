import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { IconFile } from '@/components/icons'
import { fileUrl } from '@/lib/files'
import { fmtDate, fmtRel, hm } from '@/lib/time'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { canModerate, channelAudience, myRoleKeys, postVisible } from '../../lib'
import { audienceNames, inAudience } from '@/lib/audience'
import { ackPostAction, commentAction, deletePostAction, pinPostAction, remindAckAction } from '../../actions'
import { ActButton } from '../../_ui/ActButton'
import { Textarea } from '@/components/ui/fields'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  const post = ctx.can('team.read') ? await db.post.findFirst({ where: { id: (await params).id, channel: { orgId: ctx.org.id } }, select: { title: true, authorId: true, audienceRoles: true, channel: true } }) : null
  const visible = post && postVisible(ctx, post, await myRoleKeys(ctx.user.id)) && (!post.channel.archived || canModerate(ctx, post.channel))
  return { title: visible ? `${post.title} · ${t('nav.team')}` : t('nav.team') }
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t, user, locale } = ctx
  if (!ctx.can('team.read')) return <Forbidden text={t('common.notAllowed')} />
  const { id } = await params
  const now = new Date()
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)

  const post = await db.post.findFirst({
    where: { id, channel: { orgId: ctx.org.id } },
    include: { channel: true, author: { select: { id: true, firstName: true, lastName: true, jobTitle: true } }, comments: { orderBy: { createdAt: 'asc' } } },
  })
  const moderator = post ? canModerate(ctx, post.channel) : false
  const isAuthor = post?.authorId === user.id
  const expired = !!post?.expiresAt && post.expiresAt <= now
  if (!post || !postVisible(ctx, post, await myRoleKeys(user.id)) || (expired && !moderator && !isAuthor) || (post.channel.archived && !moderator)) {
    return (
      <main className="panel main" style={{ flex: 1 }}>
        <div className="view-head"><div><span className="lbl">{t('team.label')}</span><h1>{t('team.title')}</h1></div><Link className="btn" href="/team">{t('team.post.back')}</Link></div>
        <div className="tabpanel"><div className="alert warn"><span className="grow">{t('team.post.notFound')}</span></div></div>
      </main>
    )
  }

  const [files, myAck, commenters] = await Promise.all([
    post.fileIds.length ? db.fileObject.findMany({ where: { id: { in: post.fileIds }, orgId: ctx.org.id } }) : [],
    post.requireAck ? db.acknowledgement.findFirst({ where: { userId: user.id, subjectType: 'post', subjectId: post.id } }) : null,
    db.user.findMany({ where: { orgId: ctx.org.id, id: { in: [...new Set(post.comments.map((c) => c.authorId))] } }, select: { id: true, firstName: true, lastName: true, initials: true } }),
  ])
  const who = new Map(commenters.map((u) => [u.id, u]))

  const showStats = post.requireAck && (isAuthor || moderator)
  // Lesebestätigung nur für die Zielgruppe (Moderation ausserhalb der Zielgruppe sieht nur den Stand)
  const addressed = inAudience(post.audienceRoles, await myRoleKeys(user.id))
  let stats: { confirmed: { id: string; name: string; job: string | null; at: Date }[]; missing: { id: string; name: string; job: string | null }[]; total: number } | null = null
  if (showStats) {
    const [all, acks] = await Promise.all([
      channelAudience(ctx.org.id, post.channel, post.audienceRoles),
      db.acknowledgement.findMany({ where: { subjectType: 'post', subjectId: post.id }, orderBy: { at: 'desc' } }),
    ])
    const audience = all.filter((u) => u.id !== post.authorId) // Verfassende zählen nicht zur Zielgruppe
    const at = new Map(acks.map((a) => [a.userId, a.at]))
    stats = {
      confirmed: audience.filter((u) => at.has(u.id)).map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName}`, job: u.jobTitle, at: at.get(u.id)! })).sort((a, b) => b.at.getTime() - a.at.getTime()),
      missing: audience.filter((u) => !at.has(u.id)).map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName}`, job: u.jobTitle })),
      total: audience.length,
    }
  }
  const fmtSize = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB')

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <span className="lbl">{post.channel.name} · {t('team.kinds.' + post.channel.kind)}</span>
          <h1>{post.title}</h1>
          <p className="sub">{post.author.firstName} {post.author.lastName}{post.author.jobTitle ? ` · ${post.author.jobTitle}` : ''} · {rel(post.publishedAt)}</p>
          {post.audienceRoles.length > 0 && <p className="small muted" style={{ margin: '2px 0 0' }}>{t('team.audience.line', { roles: (await audienceNames(ctx.org.id, post.audienceRoles)).join(', ') })}</p>}
        </div>
        <div className="row">
          <Link className="btn ghost" href="/team">← {t('team.post.back')}</Link>
          {moderator && !expired && (
            <ActButton action={pinPostAction.bind(null, post.id, !post.pinned)} className="btn">{t(post.pinned ? 'team.post.unpin' : 'team.post.pin')}</ActButton>
          )}
          {(moderator || isAuthor) && !expired && (
            <ActButton action={deletePostAction.bind(null, post.id)} className="btn danger" confirm="team.post.deleteConfirm" context={<span><strong>{post.title}</strong> · {post.channel.name}</span>}>{t('team.post.delete')}</ActButton>
          )}
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="row" style={{ gap: 6 }}>
            {expired && <span className="tag">{t('team.post.expired')}</span>}
            {post.pinned && <span className="tag outline">{t('team.feed.pinned')}</span>}
            {post.important && <span className="tag warn">{t('team.feed.important')}</span>}
            {post.requireAck && <span className="tag accent">{t('team.feed.ack')}</span>}
          </div>

          {post.requireAck && addressed && !expired && !isAuthor && (
            myAck ? (
              <div className="alert ok"><span className="grow"><strong>✓ {t('team.ack.saved')}</strong>{t('team.ack.done', { date: `${fmtDate(myAck.at, locale)} ${hm(myAck.at)}` })}</span></div>
            ) : (
              <div className="alert warn">
                <span className="grow"><strong>{t('team.ack.title')}</strong><span className="fg">{t('team.ack.required')}</span></span>
              </div>
            )
          )}

          <div className={stats ? 'team-grid' : 'stack'}>
            <div className="stack">
              <article className="card">
                <div className="card-body">
                  <div className="prose" style={{ whiteSpace: 'pre-wrap' }}>{post.body}</div>
                </div>
                {(post.eventAt || post.eventPlace || post.expiresAt) && (
                  <div className="card-foot">
                    <dl className="kv">
                      {post.eventAt && <><dt>{t('team.post.eventAt')}</dt><dd className="mono">{fmtDate(post.eventAt, locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} {hm(post.eventAt)}</dd></>}
                      {post.eventPlace && <><dt>{t('team.post.eventPlace')}</dt><dd>{post.eventPlace}</dd></>}
                      {post.expiresAt && <><dt>{t('team.post.expiresAt')}</dt><dd className="mono">{fmtDate(post.expiresAt, locale)}</dd></>}
                    </dl>
                  </div>
                )}
              </article>

              {files.length > 0 && (
                <section className="card" aria-labelledby="att">
                  <div className="card-head"><h2 id="att">{t('team.post.attachments')}</h2><span className="pill">{files.length}</span></div>
                  <ul className="list">
                    {files.map((f) => (
                      <li key={f.id}>
                        <a className="li" href={fileUrl(f.id)} target="_blank" rel="noreferrer">
                          <IconFile size={18} />
                          <span className="grow">{f.filename}</span>
                          <span className="small muted mono">{fmtSize(f.size)}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {post.requireAck && addressed && !expired && !isAuthor && !myAck && (
                <div className="alert warn team-ack-end" id="ack-end">
                  <span className="grow fg">{t('team.ux.ackEnd')}</span>
                  <ActButton action={ackPostAction.bind(null, post.id)} className="btn primary" optimistic={<>✓ {t('team.ack.confirmed')}</>} optimisticClassName="btn">✓ {t('team.ack.button')}</ActButton>
                </div>
              )}

              <section className="card" aria-labelledby="cm">
                <div className="card-head"><h2 id="cm">{t('team.comments.title')}</h2><span className="pill">{post.comments.length}</span></div>
                {post.comments.length ? (
                  <ul className="list">
                    {post.comments.map((c) => {
                      const u = who.get(c.authorId)
                      return (
                        <li key={c.id} className="li">
                          <span className="av sm muted">{u?.initials ?? '–'}</span>
                          <div className="grow">
                            <div className="row" style={{ gap: 8 }}><span style={{ fontWeight: 600 }}>{u ? `${u.firstName} ${u.lastName}` : '–'}</span><span className="small muted mono">{rel(c.createdAt)}</span></div>
                            <p style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap', fontWeight: 400 }}>{c.body}</p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : <div className="card-body small muted">{t('team.comments.empty')}</div>}
                {!expired && (
                  <div className="card-foot">
                    <ActionForm action={commentAction.bind(null, post.id)} success="team.comments.saved" className="stack-sm">
                      <label className="sr-only" htmlFor="cbody">{t('team.comments.placeholder')}</label>
                      <Textarea id="cbody" name="body" rows={2} placeholder={t('team.comments.placeholder')} style={{ minHeight: 60 }} maxLength={4000} />
                      <div className="form-actions"><Submit className="btn sm">{t('team.comments.send')}</Submit></div>
                    </ActionForm>
                  </div>
                )}
              </section>
            </div>

            {stats && (
              <aside className="stack">
                <section className="card" aria-labelledby="acks">
                  <div className="card-head"><h2 id="acks">{t('team.ack.title')}</h2></div>
                  <div className="card-body stack-sm">
                    <div className="mono" style={{ fontSize: '1.25rem' }}>{stats.confirmed.length} <small className="muted" style={{ fontSize: '0.8125rem' }}>/ {stats.total}</small></div>
                    <div>{t('team.ack.summary', { n: stats.confirmed.length, total: stats.total })}</div>
                    <div className="bar" role="img" aria-label={t('team.ack.summary', { n: stats.confirmed.length, total: stats.total })}>
                      <i className={stats.missing.length ? 'warn' : 'ok'} style={{ width: `${stats.total ? Math.round((stats.confirmed.length / stats.total) * 100) : 0}%` }} />
                    </div>
                    <span className="small muted">{t(post.audienceRoles.length ? 'team.audience.statsHint' : 'team.ack.audienceHint')}</span>
                  </div>
                  <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
                    <h3>{t('team.ack.missing')} <span className="pill warn" style={{ marginLeft: 4 }}>{stats.missing.length}</span></h3>
                    {stats.missing.length > 0 && !expired && <ActButton action={remindAckAction.bind(null, post.id)} className="btn sm">{t('team.ack.remind')}</ActButton>}
                  </div>
                  {stats.missing.length ? (
                    <ul className="list">
                      {stats.missing.map((m) => <li key={m.id} className="li"><span className="grow">{m.name}</span><span className="small muted">{m.job}</span></li>)}
                    </ul>
                  ) : <div className="card-body small ok-text">{t('team.ack.allDone')}</div>}
                  {stats.confirmed.length > 0 && (
                    <details className="card-foot">
                      <summary className="small">{t('team.ack.confirmed')} ({stats.confirmed.length})</summary>
                      <ul className="list" style={{ marginTop: 6 }}>
                        {stats.confirmed.map((m) => <li key={m.id} className="row-between small" style={{ padding: '4px 0' }}><span>✓ {m.name}</span><span className="mono muted">{rel(m.at)}</span></li>)}
                      </ul>
                    </details>
                  )}
                </section>
              </aside>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
