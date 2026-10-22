import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtRel, startOfDay } from '@/lib/time'
import { domainLabel } from '@/lib/care'
import { listShort } from '@/lib/shift-changes'
import { approvalQueue, approvalUnitIds } from '@/lib/careplan-review'
import { Empty, Forbidden } from '@/components/ui/Empty'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('care.approvals.title') }
}

/** Ab so vielen Tagen Wartezeit wird die Einreichung als «wartet seit …» hervorgehoben. */
const WAIT_DAYS = 3

/**
 * Freigabeliste der Pflegeplanung (PRD §9, §49 «Review»): eingereichte Entwürfe aller Bereiche, in denen die Person
 * freigeben darf, mit den Änderungen gegenüber der freigegebenen Version. Die Freigabe selbst erfolgt in der Akte.
 */
export default async function ApprovalsPage() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  const unitIds = approvalUnitIds(ctx)
  if (!unitIds.length) return <Forbidden text={t('common.notAllowed')} title={t('care.approvals.title')} />
  const [rows, domains] = await Promise.all([
    approvalQueue(ctx, unitIds),
    db.careDomain.findMany({ where: { orgId: ctx.org.id }, select: { key: true, name: true } }),
  ])
  const now = new Date()
  const multiUnit = new Set(rows.map((r) => r.resident.unit)).size > 1 || unitIds.length > 1
  const dl = (key: string) => domainLabel(t, key, domains.find((d) => d.key === key)?.name)
  const parts = (c: { added: string[]; removed: string[]; changed: string[] }, map: (s: string) => string = (s) => s) =>
    [
      c.added.length ? t('care.approvals.added', { list: listShort(c.added.map(map), 4) }) : '',
      c.changed.length ? t('care.approvals.changed', { list: listShort(c.changed.map(map), 4) }) : '',
      c.removed.length ? t('care.approvals.removed', { list: listShort(c.removed.map(map), 4) }) : '',
    ].filter(Boolean).join(' · ')

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <Link href="/tasks" className="lbl" style={{ textDecoration: 'none' }}>{t('nav.tasks')} · {t('care.approvals.label')}</Link>
          <h1>{t('care.approvals.title')}</h1>
          {rows.length > 0 && <p className="sub">{t('care.approvals.sub', { n: rows.length })}</p>}
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          {rows.length === 0 ? (
            <Empty title={t('care.approvals.empty')}>{t('care.approvals.emptyHint')}</Empty>
          ) : (
            <ul className="list card" aria-label={t('care.approvals.listLabel')}>
              {rows.map((r) => {
                const days = Math.floor((startOfDay(now).getTime() - startOfDay(r.submittedAt).getTime()) / 86_400_000)
                const when = fmtRel(r.submittedAt, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
                const areas = parts({ added: r.changes.areasAdded, changed: r.changes.areasChanged, removed: r.changes.areasRemoved }, dl)
                const ivs = parts(r.changes.ivs)
                const none = r.activeVersion != null ? t('care.approvals.none', { v: r.activeVersion }) : '–'
                return (
                  <li key={r.planId}>
                    <div className="li appr-row">
                      <div className="grow stack-sm">
                        <div className="row" style={{ gap: 8 }}>
                          <Link className="linkbtn" href={`/residents/${r.resident.id}`}><strong>{r.resident.name}</strong></Link>
                          {r.resident.room && <span className="roomtag">{r.resident.room}</span>}
                          <span className={'tag ' + (r.changes.first ? 'accent' : 'outline')}>
                            {r.changes.first || r.activeVersion == null ? t('care.approvals.first', { v: r.version }) : t('care.approvals.replaces', { v: r.version, prev: r.activeVersion })}
                          </span>
                          {multiUnit && <span className="small muted">{r.resident.unit}</span>}
                        </div>
                        <div className="small fg2">
                          {r.submittedBy ? t('care.approvals.submittedBy', { name: r.submittedBy, when }) : t('care.approvals.submitted', { when })}
                          {days >= WAIT_DAYS && <> <span className="tag warn">{t('care.approvals.waiting', { n: days })}</span></>}
                        </div>
                        <dl className="kv">
                          <dt>{t('care.approvals.areas')}</dt><dd>{areas || none}</dd>
                          <dt>{t('care.approvals.measures')}</dt><dd>{ivs || none}</dd>
                        </dl>
                      </div>
                      <Link className="btn" href={`/residents/${r.resident.id}/careplan?v=draft`} aria-label={t('care.approvals.openAria', { name: r.resident.name })}>
                        {t('care.approvals.open')}
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  )
}
