import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { fmtRel } from '@/lib/time'
import { portalEnabled } from '@/lib/portal/module'
import { ModuleOff } from '../../Head'
import { assignees, staffName, threadInScope } from '../../lib'
import { AssignForm, ThreadReply, ThreadStatus, ToChart } from '../../ItemActions'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('portal.team.title') }
}

export default async function FamilyThread({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!portalEnabled(ctx.org)) return <ModuleOff ctx={ctx} />
  const th = await threadInScope(ctx, (await params).id)
  if (!th) notFound()
  const [messages, people] = await Promise.all([
    db.portalMessage.findMany({ where: { threadId: th.id }, orderBy: { createdAt: 'asc' } }),
    assignees(ctx.org.id, th.resident.unitId),
  ])
  const authorIds = [...new Set(messages.map((m) => m.userId).filter((x): x is string => !!x))]
  const authors = new Map((await db.user.findMany({ where: { id: { in: authorIds }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, staffName(u)]))
  if (!th.staffReadAt || th.staffReadAt < th.lastMessageAt) await db.portalThread.updateMany({ where: { id: th.id }, data: { staffReadAt: new Date() } })
  await audit(ctx, { action: 'portal.message.view', entityType: 'PortalThread', entityId: th.id, context: { residentId: th.residentId } })
  const r = th.resident
  const who = th.access?.account?.name ?? th.access?.inviteName ?? '–'
  const canChart = ctx.can('resident.chart.write', { unitId: r.unitId, locationId: r.unit.locationId })
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, new Date(), locale)
  const context = `${r.lastName} ${r.firstName} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <Link className="lbl" href="/team/family">← {t('portal.team.tabs.inbox')}</Link>
          <h1>{th.subject}</h1>
          <p className="sub">
            <Link href={`/residents/${r.id}/contacts`}>{context}</Link> · {t('portal.team.from', { name: who })}
            {th.access?.role === 'legal_rep' && <> · {t('portal.roles.legal_rep')}</>}
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className={'tag ' + (th.status === 'open' ? 'accent' : th.status === 'answered' ? 'ok' : '')}>{t('portal.threadStatus.' + th.status)}</span>
          <ThreadStatus threadId={th.id} status={th.status} />
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel portal-team-detail">
          <section className="card" aria-label={t('portal.messages.conversation')}>
            <ol className="portal-msgs">
              {messages.map((m) => (
                <li key={m.id} className={'portal-msg ' + (m.side === 'staff' ? 'mine' : 'team')}>
                  <div className="small muted row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <strong className="fg2">{m.side === 'staff' ? (m.userId ? authors.get(m.userId) ?? '–' : '–') : who}</strong>
                    <time dateTime={m.createdAt.toISOString()}>{rel(m.createdAt)}</time>
                    {m.side === 'family' && (m.observationId
                      ? <span className="tag ok">✓ {t('portal.team.inChartTag')}</span>
                      : canChart && <ToChart threadId={th.id} messageId={m.id} text={m.body} context={context} />)}
                  </div>
                  <p>{m.body}</p>
                </li>
              ))}
            </ol>
            <div className="card-foot portal-reply"><ThreadReply threadId={th.id} context={context} /></div>
          </section>
          <aside className="card" aria-labelledby="ft-assign">
            <div className="card-head"><h2 id="ft-assign">{t('portal.team.assignee')}</h2></div>
            <div className="card-body">
              <AssignForm kind="message" id={th.id} value={th.assigneeId ?? ''} options={people.map((u) => ({ value: u.id, label: `${u.lastName} ${u.firstName}`, hint: u.jobTitle ?? undefined }))} />
            </div>
            {th.access?.account && (
              <div className="card-body small fg2" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="lbl">{t('portal.team.contactPerson')}</span>
                <div>{th.access.account.name}</div>
                {th.access.account.phone && <div className="mono"><a href={`tel:${th.access.account.phone.replace(/\s/g, '')}`}>{th.access.account.phone}</a></div>}
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}
