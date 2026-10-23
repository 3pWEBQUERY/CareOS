import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { aiConfigured } from '@/lib/env'
import { CATEGORY_TONE, DOC_CATEGORIES, queryTerms, scoreDoc, snippet, userNames, validity, versionState } from '@/lib/docs'
import { fmtDate } from '@/lib/time'
import { AssistantAi, NewDocButton } from './DocsClient'
import { inAudience, roleOptions } from '@/lib/audience'
import { myRoleKeys } from '@/app/(app)/team/lib'
import { TextField } from '@/components/ui/fields'
import { reviewOverdue } from '@/lib/docs-review'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('nav.docs') }
}

type SP = { q?: string; cat?: string; f?: string }

export default async function DocsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('docs.read')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const q = (sp.q ?? '').trim().slice(0, 200)
  const cat = DOC_CATEGORIES.includes(sp.cat as never) ? sp.cat! : null
  const manage = ctx.can('docs.manage')
  const f = ['ack', ...(manage ? ['pending', 'archived'] : [])].includes(sp.f ?? '') ? sp.f! : null
  const now = new Date()

  const docs = await db.document.findMany({
    where: { orgId: ctx.org.id, status: manage ? undefined : 'approved' },
    include: { versions: { select: { id: true, version: true, body: true, approvedAt: true, submittedAt: true, critical: true, createdAt: true, changeNote: true, reviewerId: true, reviewDueAt: true } } },
    orderBy: { title: 'asc' },
  })
  const [acks, myKeys, roles] = await Promise.all([
    db.acknowledgement.findMany({ where: { userId: ctx.user.id, subjectType: 'document', subjectId: { in: docs.map((d) => d.id) } }, select: { subjectId: true, version: true } }),
    myRoleKeys(ctx.user.id),
    manage ? roleOptions(ctx.org.id) : Promise.resolve([]),
  ])
  const acked = new Set(acks.map((a) => a.subjectId + ':' + a.version))
  const owners = await userNames(ctx.org.id, docs.flatMap((d) => [d.ownerId, ...d.versions.map((v) => v.reviewerId)]))
  const terms = queryTerms(q)

  const rows = docs.map((d) => {
    const cur = d.versions.find((v) => v.version === d.currentVersion && v.approvedAt)
    const pending = d.versions.find((v) => !v.approvedAt)
    const body = cur?.body ?? pending?.body ?? ''
    // Kenntnisnahme nur für die Zielgruppe des Dokuments (Rollen, PRD §45)
    const needsAck = d.status === 'approved' && d.requireAck && !!d.currentVersion && !acked.has(d.id + ':' + d.currentVersion) && inAudience(d.audienceRoles, myKeys)
    return {
      d, cur, pending, needsAck, body,
      score: q ? scoreDoc({ ...d, body }, terms, t('docs.cat.' + d.category)) : 1,
      valid: validity(d.validUntil, now),
    }
  })
  const visible = (r: (typeof rows)[number]) => (f === 'archived' ? r.d.status === 'archived' : r.d.status !== 'archived')
  const base = rows.filter(visible)
  const count = {
    ack: rows.filter((r) => r.needsAck).length,
    pending: rows.filter((r) => r.d.status !== 'archived' && r.pending).length,
    archived: rows.filter((r) => r.d.status === 'archived').length,
  }
  const catCount = (c: string) => base.filter((r) => r.d.category === c && r.score > 0).length
  let list = base.filter((r) => r.score > 0)
  if (cat) list = list.filter((r) => r.d.category === cat)
  if (f === 'ack') list = list.filter((r) => r.needsAck)
  if (f === 'pending') list = list.filter((r) => r.pending)
  if (q) list = [...list].sort((a, b) => b.score - a.score)

  const best = q && terms.length ? rows.filter((r) => r.d.status === 'approved' && r.cur && r.score > 0).sort((a, b) => b.score - a.score)[0] : undefined
  const isQuestion = q.split(/\s+/).length >= 3 || q.endsWith('?')
  const aiOn = aiConfigured() && ctx.can('ai.use')

  const href = (p: Partial<SP>) => {
    const u = new URLSearchParams()
    const m = { q: q || undefined, cat: cat ?? undefined, f: f ?? undefined, ...p }
    for (const [k, v] of Object.entries(m)) if (v) u.set(k, v)
    const s = u.toString()
    return '/docs' + (s ? '?' + s : '')
  }

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">CareOS Docs</span>
          <h1>{t('docs.title')}</h1>
          <p className="sub">{t('docs.subtitle', { n: base.length })}{count.ack ? ' · ' + t('docs.toAckCount', { n: count.ack }) : ''}</p>
        </div>
        {manage && <NewDocButton roles={roles} />}
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <section className="stack-sm" aria-labelledby="ask">
            <h2 className="sr-only" id="ask">{t('docs.assistant.title')}</h2>
            <form className="row" action="/docs" role="search">
              {cat && <input type="hidden" name="cat" value={cat} />}
              {f && <input type="hidden" name="f" value={f} />}
              <TextField type="search" name="q" defaultValue={q} placeholder={t('docs.assistant.placeholder')} aria-label={t('docs.assistant.title')} style={{ minWidth: 220 }} className="grow" />
              <button className="btn primary" type="submit">{t('common.search')}</button>
              {q && <Link className="btn ghost" href={href({ q: undefined })}>{t('docs.clear')}</Link>}
            </form>
            {q && (
              best ? (
                <div className="card">
                  <div className="card-body stack-sm">
                    <span className="lbl">{t('docs.assistant.best')}</span>
                    <div className="row-between">
                      <Link href={`/docs/${best.d.id}`} style={{ fontWeight: 600 }}>{best.d.title}</Link>
                      <span className="row small"><span className={'tag ' + (CATEGORY_TONE[best.d.category] ?? '')}>{t('docs.cat.' + best.d.category)}</span><span className="mono">v{best.d.currentVersion}</span>{best.cur?.approvedAt && <span className="muted">{t('docs.approvedOn', { date: fmtDate(best.cur.approvedAt, locale) })}</span>}</span>
                    </div>
                    <p className="small fg2" style={{ margin: 0 }}>{snippet(best.body, terms, 240)}</p>
                  </div>
                </div>
              ) : (
                <div className="alert"><span className="grow">{t('docs.assistant.none')}</span></div>
              )
            )}
            {q && aiOn && best && <AssistantAi q={q} auto={isQuestion} />}
          </section>

          {count.ack > 0 && !q && f !== 'ack' && (
            <section className="card warn" aria-labelledby="toack">
              <div className="card-head"><h2 id="toack">{t('docs.ux.ackTitle')}</h2><span className="pill warn">{count.ack}</span></div>
              <ul className="list">
                {rows.filter((r) => r.needsAck).map(({ d, cur }) => (
                  <li key={d.id}>
                    <Link className="li" href={`/docs/${d.id}`} style={{ alignItems: 'center' }}>
                      <span className="grow">
                        <span>{d.title} <span className="mono small muted" style={{ fontWeight: 400 }}>v{d.currentVersion}</span></span>
                        {cur?.critical && cur.changeNote && <span className="small fg2" style={{ display: 'block', fontWeight: 400 }}><span className="tag crit">{t('docs.critical')}</span> {cur.changeNote}</span>}
                      </span>
                      <span className="btn sm primary" aria-hidden="true">{t('docs.ux.readAndAck')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <nav className="chips docs-chips" aria-label={t('common.filter')}>
            <Link className="chip" href={href({ cat: undefined, f: undefined })} aria-current={!cat && !f ? 'page' : undefined}>{t('common.all')} <span className="mono muted">{base.filter((r) => r.score > 0).length}</span></Link>
            {DOC_CATEGORIES.map((c) => (
              <Link key={c} className="chip" href={href({ cat: cat === c ? undefined : c })} aria-current={cat === c ? 'page' : undefined}>{t('docs.cat.' + c)} <span className="mono muted">{catCount(c)}</span></Link>
            ))}
          </nav>
          <nav className="chips docs-chips" aria-label={t('docs.statusFilter')}>
            <Link className="chip" href={href({ f: f === 'ack' ? undefined : 'ack' })} aria-current={f === 'ack' ? 'page' : undefined}>{t('docs.filterAck')} <span className={'mono ' + (count.ack ? 'warn-text' : 'muted')}>{count.ack}</span></Link>
            {manage && <Link className="chip" href={href({ f: f === 'pending' ? undefined : 'pending' })} aria-current={f === 'pending' ? 'page' : undefined}>{t('docs.filterPending')} <span className="mono muted">{count.pending}</span></Link>}
            {manage && <Link className="chip" href={href({ f: f === 'archived' ? undefined : 'archived' })} aria-current={f === 'archived' ? 'page' : undefined}>{t('docs.filterArchived')} <span className="mono muted">{count.archived}</span></Link>}
          </nav>

          {list.length ? (
            <div className="tablewrap rwrap">
              <table className="stable rtable r-inline">
                <thead>
                  <tr>
                    <th>{t('docs.col.title')}</th>
                    <th>{t('docs.col.category')}</th>
                    <th>{t('docs.col.version')}</th>
                    <th>{t('docs.col.status')}</th>
                    <th>{t('docs.col.validUntil')}</th>
                    <th>{t('docs.col.owner')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(({ d, pending, needsAck, valid, body }) => (
                    <tr key={d.id} className="clickable">
                      <td className="r-title" style={{ minWidth: 240 }}>
                        <Link href={`/docs/${d.id}`} style={{ fontWeight: 500 }}>{d.title}</Link>
                        {needsAck && <> <span className="tag warn">{t('docs.toAck')}</span></>}
                        {q ? <div className="small muted" style={{ maxWidth: '60ch' }}>{snippet(body, terms, 140)}</div>
                          : d.tags.length > 0 && <div className="small muted">{d.tags.slice(0, 5).join(' · ')}</div>}
                      </td>
                      <td><span className={'tag ' + (CATEGORY_TONE[d.category] ?? '')}>{t('docs.cat.' + d.category)}</span></td>
                      <td className="num" data-label={t('docs.col.version')}>{d.currentVersion ?? '–'}{pending && manage && <div className="small muted">→ {pending.version}</div>}</td>
                      <td>
                        <span className={'tag ' + ({ approved: 'ok', review: 'violet', draft: '', archived: 'outline' }[d.status])}>{t('docs.status.' + d.status)}</span>
                        {pending && manage && d.status === 'approved' && <div className="small muted nowrap">{t('docs.pendingVersion', { v: pending.version, state: t('docs.vstate.' + versionState(pending)) })}</div>}
                        {pending?.submittedAt && manage && (
                          <div className={'small nowrap ' + (reviewOverdue(pending, now) ? 'crit-text' : 'muted')}>
                            {t('docs.review.assigned', { who: pending.reviewerId ? owners.get(pending.reviewerId) ?? '–' : t('docs.review.anyApprover') })}
                            {pending.reviewDueAt && <> · {t(reviewOverdue(pending, now) ? 'docs.review.overdue' : 'docs.review.dueOn', { date: fmtDate(pending.reviewDueAt, locale) })}</>}
                          </div>
                        )}
                      </td>
                      <td className="nowrap" data-label={t('docs.col.validUntil')}>
                        {d.validUntil ? (
                          <span className={valid === 'expired' ? 'crit-text' : valid === 'soon' ? 'warn-text' : ''}>
                            <span className="mono">{fmtDate(d.validUntil, locale)}</span>
                            {valid !== 'ok' && <div className="small">{t('docs.valid.' + valid)}</div>}
                          </span>
                        ) : <span className="muted">–</span>}
                      </td>
                      <td className="nowrap hide-sm" data-label={t('docs.col.owner')}>{owners.get(d.ownerId) ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title={t('docs.emptyTitle')}>{q ? t('docs.emptySearch') : t('docs.emptyHint')}</Empty>
          )}
        </div>
      </div>
    </main>
  )
}
