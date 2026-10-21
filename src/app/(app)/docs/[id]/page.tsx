import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { Markdown } from '@/lib/markdown'
import { fileUrl } from '@/lib/files'
import { ackAudience, CATEGORY_TONE, lineDiff, loadDoc, nextVersion, userNames, validity, versionState } from '@/lib/docs'
import { dateKey, fmtDate, hm } from '@/lib/time'
import { IconFile } from '@/components/icons'
import { acknowledgeDocument, approveVersion, archiveDocument, deleteDraft, remindAck, returnToDraft, submitVersion } from '../actions'
import { ActBtn, MetaButton, VersionButton } from '../DocsClient'

export default async function DocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string; diff?: string }> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('docs.read')) return <Forbidden text={t('common.notAllowed')} />
  const { id } = await params
  const sp = await searchParams
  const doc = await loadDoc(ctx, id)
  if (!doc) notFound()
  const manage = ctx.can('docs.manage')
  const approve = ctx.can('docs.approve')
  if (doc.status !== 'approved' && !manage) notFound()

  const versions = manage ? doc.versions : doc.versions.filter((v) => v.approvedAt)
  const current = versions.find((v) => v.version === doc.currentVersion && v.approvedAt) ?? null
  const pending = manage ? versions.find((v) => !v.approvedAt) ?? null : null
  const shown = (sp.v && versions.find((v) => v.version === sp.v)) || current || pending || versions[0]
  if (!shown) notFound()
  const idx = versions.indexOf(shown)
  const previous = versions.slice(idx + 1).find((v) => v.approvedAt) ?? null
  const showDiff = sp.diff === '1' && previous

  const files = await db.fileObject.findMany({ where: { orgId: ctx.org.id, id: { in: versions.map((v) => v.fileId).filter((x): x is string => !!x) } }, select: { id: true, filename: true, size: true } })
  const fileById = new Map(files.map((f) => [f.id, f]))
  const names = await userNames(ctx.org.id, [doc.ownerId, ...versions.flatMap((v) => [v.authorId, v.approvedById])])
  const now = new Date()
  const valid = validity(doc.validUntil, now)

  const myAck = doc.currentVersion
    ? await db.acknowledgement.findUnique({ where: { userId_subjectType_subjectId_version: { userId: ctx.user.id, subjectType: 'document', subjectId: doc.id, version: doc.currentVersion } } })
    : null
  const ackRelevant = doc.requireAck && doc.status === 'approved' && !!current

  let overview: { total: number; done: number; missing: { id: string; name: string; unit: string | null }[] } | null = null
  if (manage && ackRelevant) {
    const [audience, acks] = await Promise.all([
      ackAudience(ctx.org.id),
      db.acknowledgement.findMany({ where: { subjectType: 'document', subjectId: doc.id, version: doc.currentVersion! }, select: { userId: true } }),
    ])
    const done = new Set(acks.map((a) => a.userId))
    const missingIds = audience.filter((u) => !done.has(u))
    const users = await db.user.findMany({ where: { id: { in: missingIds } }, select: { id: true, firstName: true, lastName: true, primaryUnitId: true }, orderBy: { lastName: 'asc' } })
    const unitName = new Map(ctx.units.map((u) => [u.id, u.shortName ?? u.name]))
    overview = {
      total: audience.length,
      done: audience.filter((u) => done.has(u)).length,
      missing: users.map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName}`, unit: u.primaryUnitId ? unitName.get(u.primaryUnitId) ?? null : null })),
    }
  }

  const allUsers = manage ? await db.user.findMany({ where: { orgId: ctx.org.id, active: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }) : []
  const vstate = (v: (typeof versions)[number]) => versionState(v)
  const vHref = (v: string, diff = false) => `/docs/${doc.id}?v=${encodeURIComponent(v)}${diff ? '&diff=1' : ''}`
  const shownFile = shown.fileId ? fileById.get(shown.fileId) : null
  const fmtDT = (d: Date) => `${fmtDate(d, locale)} ${hm(d)}`

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <span className="lbl"><Link href="/docs" style={{ color: 'inherit' }}>CareOS Docs</Link> · {t('docs.cat.' + doc.category)}</span>
          <h1>{doc.title}</h1>
          <p className="sub">
            {current
              ? t('docs.headCurrent', { v: current.version, date: fmtDate(current.approvedAt!, locale), by: names.get(current.approvedById ?? '') ?? '–' })
              : t('docs.headNoCurrent')}
          </p>
        </div>
        {manage && (
          <div className="row">
            <MetaButton
              d={{ id: doc.id, title: doc.title, category: doc.category, tags: doc.tags, requireAck: doc.requireAck, validFrom: doc.validFrom ? dateKey(doc.validFrom) : null, validUntil: doc.validUntil ? dateKey(doc.validUntil) : null, ownerId: doc.ownerId }}
              users={allUsers.map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName}` }))}
            />
            {!pending && doc.status !== 'archived' && (
              <VersionButton className="btn primary" label={t('docs.version.new')} documentId={doc.id} suggest={nextVersion(doc.currentVersion, false)} suggestCritical={nextVersion(doc.currentVersion, true)} baseBody={current?.body ?? ''} hasFile={!!current?.fileId} />
            )}
            {approve && doc.status !== 'archived' && <ActBtn className="btn ghost" label={t('docs.archive')} confirm={t('docs.archiveConfirm')} success="docs.archived" action={archiveDocument.bind(null, doc.id, false)} />}
            {approve && doc.status === 'archived' && <ActBtn label={t('docs.restore')} success="common.saved" action={archiveDocument.bind(null, doc.id, true)} />}
          </div>
        )}
      </div>
      <div className="scroll">
        <div className="tabpanel">
          {doc.status === 'archived' && <div className="alert"><span className="grow">{t('docs.archivedHint')}</span></div>}

          {pending && (
            <div className={'alert ' + (pending.submittedAt ? 'info' : '')}>
              <div className="grow">
                <strong className="fg">{t('docs.pendingHead', { v: pending.version, state: t('docs.vstate.' + vstate(pending)) })}</strong>
                <span className="fg2">
                  {t('docs.pendingMeta', { by: names.get(pending.authorId) ?? '–', date: fmtDT(pending.createdAt) })}
                  {pending.changeNote ? ' · ' + pending.changeNote : ''}
                  {pending.critical ? ' · ' + t('docs.criticalChange') : ''}
                </span>
              </div>
              <div className="row">
                {shown.id !== pending.id && <Link className="btn sm" href={vHref(pending.version)}>{t('docs.view')}</Link>}
                {!pending.submittedAt && (
                  <>
                    <VersionButton className="btn sm" label={t('common.edit')} documentId={doc.id} draft={{ id: pending.id, version: pending.version, body: pending.body, changeNote: pending.changeNote, critical: pending.critical, fileName: pending.fileId ? fileById.get(pending.fileId)?.filename ?? 'file' : null }} />
                    {doc.currentVersion && <ActBtn className="btn sm ghost" label={t('docs.discard')} confirm={t('docs.discardConfirm')} success="docs.discarded" action={deleteDraft.bind(null, pending.id)} />}
                    <ActBtn className="btn sm primary" label={t('docs.submit')} success="docs.submitted" action={submitVersion.bind(null, pending.id)} />
                  </>
                )}
                {pending.submittedAt && approve && (
                  <>
                    <ActBtn className="btn sm" label={t('docs.returnDraft')} success="common.saved" action={returnToDraft.bind(null, pending.id)} />
                    <ActBtn className="btn sm primary" label={t('docs.approve')} confirm={t('docs.approveConfirm', { v: pending.version })} success="docs.approved" action={approveVersion.bind(null, pending.id)} />
                  </>
                )}
                {pending.submittedAt && !approve && <span className="small muted">{t('docs.waitingApproval')}</span>}
              </div>
            </div>
          )}

          {ackRelevant && shown.id === current!.id && (
            myAck ? (
              <div className="alert ok"><span className="grow">{t('docs.ack.done', { date: fmtDT(myAck.at), v: doc.currentVersion })}</span></div>
            ) : (
              <div className="alert warn">
                <div className="grow">
                  <strong>{t('docs.ack.required')}</strong>
                  <span className="fg">{current!.critical && current!.changeNote ? t('docs.ack.criticalNote', { v: current!.version, note: current!.changeNote }) : t('docs.ack.hint')}</span>
                </div>
                <ActBtn className="btn primary" label={t('docs.ack.button')} success="docs.ack.thanks" action={acknowledgeDocument.bind(null, doc.id)} />
              </div>
            )
          )}

          <div className="docs-layout">
            <div className="stack" style={{ minWidth: 0 }}>
              {shown.id !== current?.id && shown.approvedAt && current && (
                <div className="alert info"><span className="grow">{t('docs.oldVersion', { v: shown.version, cur: current.version })}</span><Link className="btn sm" href={`/docs/${doc.id}`}>{t('docs.toCurrent')}</Link></div>
              )}
              <div className="row-between">
                <div className="row">
                  <span className="lbl">{t('docs.version.label')}</span>
                  <span className="mono">{shown.version}</span>
                  <span className={'tag ' + (vstate(shown) === 'approved' ? (shown.id === current?.id ? 'ok' : '') : vstate(shown) === 'review' ? 'violet' : '')}>
                    {shown.id === current?.id ? t('docs.vstate.current') : t('docs.vstate.' + vstate(shown))}
                  </span>
                  {shown.critical && <span className="tag crit">{t('docs.critical')}</span>}
                </div>
                {previous && (
                  <div className="seg" role="group" aria-label={t('docs.viewMode')}>
                    <Link href={vHref(shown.version)} aria-current={!showDiff ? 'page' : undefined}>{t('docs.modeDoc')}</Link>
                    <Link href={vHref(shown.version, true)} aria-current={showDiff ? 'page' : undefined}>{t('docs.modeDiff', { v: previous.version })}</Link>
                  </div>
                )}
              </div>

              {showDiff ? (
                <DiffView before={previous!.body} after={shown.body} labels={{ add: t('docs.diff.add'), del: t('docs.diff.del'), none: t('docs.diff.none') }} />
              ) : (
                <article className="card"><div className="card-body" style={{ padding: '16px 18px' }}>
                  {shown.body.trim() ? <Markdown source={shown.body} /> : <p className="muted" style={{ margin: 0 }}>{t('docs.noBody')}</p>}
                </div></article>
              )}

              {shownFile && (
                <a className="card li" href={fileUrl(shownFile.id)} target="_blank" rel="noopener">
                  <IconFile size={18} />
                  <span className="grow"><span>{shownFile.filename}</span><span className="small muted"> · {Math.max(1, Math.round(shownFile.size / 1024))} kB</span></span>
                  <span className="small">{t('docs.openFile')}</span>
                </a>
              )}

              <section className="stack-sm" aria-labelledby="hist">
                <h2 className="sec" id="hist">{t('docs.history')}</h2>
                <div className="tablewrap">
                  <table className="stable">
                    <thead>
                      <tr><th>{t('docs.col.version')}</th><th>{t('docs.col.state')}</th><th>{t('docs.col.author')}</th><th>{t('docs.col.approval')}</th><th>{t('docs.col.change')}</th><th><span className="sr-only">{t('docs.view')}</span></th></tr>
                    </thead>
                    <tbody>
                      {versions.map((v, i) => {
                        const prev = versions.slice(i + 1).find((x) => x.approvedAt)
                        return (
                          <tr key={v.id} style={v.id === shown.id ? { background: 'var(--accent-soft)' } : undefined}>
                            <td className="num">{v.version}</td>
                            <td className="nowrap">
                              <span className={'tag ' + (v.id === current?.id ? 'ok' : vstate(v) === 'review' ? 'violet' : '')}>{v.id === current?.id ? t('docs.vstate.current') : t('docs.vstate.' + vstate(v))}</span>
                              {v.critical && <> <span className="tag crit">{t('docs.critical')}</span></>}
                            </td>
                            <td className="nowrap">{names.get(v.authorId) ?? '–'}<div className="small muted mono">{fmtDate(v.createdAt, locale)}</div></td>
                            <td className="nowrap">{v.approvedAt ? <>{names.get(v.approvedById ?? '') ?? '–'}<div className="small muted mono">{fmtDate(v.approvedAt, locale)}</div></> : <span className="muted">–</span>}</td>
                            <td style={{ minWidth: 200 }}>{v.changeNote ?? <span className="muted">{i === versions.length - 1 ? t('docs.firstVersion') : '–'}</span>}</td>
                            <td className="nowrap">
                              {v.id !== shown.id && <Link className="linkbtn small" href={vHref(v.version)}>{t('docs.view')}</Link>}
                              {prev && <> {v.id !== shown.id && ' · '}<Link className="linkbtn small" href={vHref(v.version, true)}>{t('docs.compare')}</Link></>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <aside className="stack">
              <section className="card" aria-labelledby="meta">
                <div className="card-head"><h2 id="meta">{t('docs.meta')}</h2><span className={'tag ' + ({ approved: 'ok', review: 'violet', draft: '', archived: 'outline' }[doc.status])}>{t('docs.status.' + doc.status)}</span></div>
                <div className="card-body">
                  <dl className="kv">
                    <dt>{t('docs.col.category')}</dt><dd><span className={'tag ' + (CATEGORY_TONE[doc.category] ?? '')}>{t('docs.cat.' + doc.category)}</span></dd>
                    <dt>{t('docs.col.version')}</dt><dd className="mono">{doc.currentVersion ?? '–'}</dd>
                    <dt>{t('docs.col.owner')}</dt><dd>{names.get(doc.ownerId) ?? '–'}</dd>
                    <dt>{t('docs.f.validFrom')}</dt><dd className="mono">{doc.validFrom ? fmtDate(doc.validFrom, locale) : '–'}</dd>
                    <dt>{t('docs.f.validUntil')}</dt>
                    <dd>{doc.validUntil ? <span className={valid === 'expired' ? 'crit-text' : valid === 'soon' ? 'warn-text' : ''}><span className="mono">{fmtDate(doc.validUntil, locale)}</span>{valid !== 'ok' && ' · ' + t('docs.valid.' + valid)}</span> : '–'}</dd>
                    <dt>{t('docs.ack.label')}</dt><dd>{doc.requireAck ? t('docs.ack.requiredShort') : t('common.no')}</dd>
                    {doc.tags.length > 0 && <><dt>{t('docs.f.tags')}</dt><dd className="chips">{doc.tags.map((tag) => <Link key={tag} className="chip" href={`/docs?q=${encodeURIComponent(tag)}`}>{tag}</Link>)}</dd></>}
                  </dl>
                </div>
              </section>

              {overview && (
                <section className="card" aria-labelledby="ackov">
                  <div className="card-head"><h2 id="ackov">{t('docs.ack.overview')}</h2><span className="mono small">v{doc.currentVersion}</span></div>
                  <div className="card-body stack-sm">
                    <div className="row-between">
                      <span>{t('docs.ack.xOfY', { x: overview.done, y: overview.total })}</span>
                      <span className="mono small">{overview.total ? Math.round((overview.done / overview.total) * 100) : 0} %</span>
                    </div>
                    <div className="bar"><i className={overview.done === overview.total ? 'ok' : ''} style={{ width: `${overview.total ? (overview.done / overview.total) * 100 : 0}%` }} /></div>
                    {overview.missing.length > 0 ? (
                      <>
                        <span className="lbl" style={{ marginTop: 4 }}>{t('docs.ack.missing', { n: overview.missing.length })}</span>
                        <ul className="list" style={{ maxHeight: 260, overflow: 'auto' }}>
                          {overview.missing.map((u) => <li key={u.id} className="row-between small" style={{ padding: '5px 0' }}><span>{u.name}</span>{u.unit && <span className="muted">{u.unit}</span>}</li>)}
                        </ul>
                        <ActBtn className="btn sm" label={t('docs.ack.remind')} action={remindAck.bind(null, doc.id)} />
                      </>
                    ) : <p className="small ok-text" style={{ margin: 0 }}>{t('docs.ack.all')}</p>}
                  </div>
                </section>
              )}
            </aside>
          </div>
        </div>
      </div>
    </main>
  )
}

function DiffView({ before, after, labels }: { before: string; after: string; labels: { add: string; del: string; none: string } }) {
  const lines = lineDiff(before, after)
  const adds = lines.filter((l) => l.op === 'add').length
  const dels = lines.filter((l) => l.op === 'del').length
  return (
    <div className="stack-sm">
      <div className="row small"><span className="ok-text mono">+{adds}</span><span>{labels.add}</span><span className="crit-text mono">−{dels}</span><span>{labels.del}</span></div>
      {adds + dels === 0 ? <p className="muted small">{labels.none}</p> : (
        <div className="diff">
          {lines.map((l, i) => (
            <div key={i} className={'diff-line ' + l.op}>
              <span className="diff-op" aria-hidden="true">{l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}</span>
              {l.op !== 'same' && <span className="sr-only">{l.op === 'add' ? labels.add : labels.del}: </span>}
              <span className="diff-text">{l.text || ' '}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
