import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { fmtDate, fmtRel, hm, weekdayShort } from '@/lib/time'
import { portalEnabled } from '@/lib/portal/module'
import { isSelfAccess } from '@/lib/portal/policy'
import { ModuleOff } from '../../Head'
import { assignees, staffName, visitInScope } from '../../lib'
import { AssignForm, VisitDecision } from '../../ItemActions'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('portal.team.title') }
}

export default async function FamilyVisit({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!portalEnabled(ctx.org)) return <ModuleOff ctx={ctx} />
  const v = await visitInScope(ctx, (await params).id)
  if (!v) notFound()
  const r = v.resident
  const [people, sameDay] = await Promise.all([
    assignees(ctx.org.id, r.unitId),
    // Andere Besuche und Termine am selben Tag (Konflikte erkennen, PRD §32)
    db.appointment.findMany({ where: { residentId: r.id, at: { gte: new Date(v.start.getFullYear(), v.start.getMonth(), v.start.getDate()), lt: new Date(v.start.getFullYear(), v.start.getMonth(), v.start.getDate() + 1) } }, select: { id: true, at: true, kind: true, title: true }, orderBy: { at: 'asc' } }),
  ])
  const decider = v.decidedById ? await db.user.findFirst({ where: { id: v.decidedById, orgId: ctx.org.id }, select: { firstName: true, lastName: true } }) : null
  if (!v.staffReadAt) await db.visitRequest.updateMany({ where: { id: v.id }, data: { staffReadAt: new Date() } })
  await audit(ctx, { action: 'portal.visit.view', entityType: 'VisitRequest', entityId: v.id, context: { residentId: r.id } })
  const who = v.access?.account?.name ?? v.access?.inviteName ?? '–'
  const context = `${r.lastName} ${r.firstName} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`
  const when = `${weekdayShort(v.start, locale)} ${fmtDate(v.start, locale)}, ${hm(v.start)}–${hm(v.end)}`
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <Link className="lbl" href="/team/family">← {t('portal.team.tabs.inbox')}</Link>
          <h1>{t('portal.team.visitHead', { when })}</h1>
          <p className="sub">
            <Link href={`/residents/${r.id}/appointments`}>{context}</Link> · {isSelfAccess(v.access) ? t('residentPortal.team.announcedBy', { name: who }) : t('portal.team.from', { name: who })}
          </p>
        </div>
        <span className={'tag ' + (v.status === 'requested' ? 'accent' : v.status === 'confirmed' ? 'ok' : v.status === 'declined' ? 'warn' : '')}>{t('portal.visitStatus.' + v.status)}</span>
      </div>
      <div className="scroll">
        <div className="tabpanel portal-team-detail">
          <section className="card" aria-labelledby="fv-req">
            <div className="card-head"><h2 id="fv-req">{t('portal.team.request')}</h2><span className="small muted">{fmtRel(v.createdAt, { today: t('common.today'), yesterday: t('common.yesterday') }, new Date(), locale)}</span></div>
            <div className="card-body stack">
              <dl className="kv">
                <dt>{t('portal.visits.date')}</dt><dd>{when}</dd>
                {v.visitorName && <><dt>{t('residentPortal.visits.visitorName')}</dt><dd>{v.visitorName}</dd></>}
                <dt>{t('portal.visits.visitors')}</dt><dd className="mono">{v.visitors}</dd>
                {v.note && <><dt>{t('portal.visits.note')}</dt><dd>{v.note}</dd></>}
                {v.reply && <><dt>{t('portal.visits.reply')}</dt><dd>{v.reply}{decider && <span className="small muted"> · {staffName(decider)}</span>}</dd></>}
              </dl>
              {sameDay.length > 0 && (
                <div className="alert info">
                  <span className="grow"><strong>{t('portal.team.sameDay')}</strong>{sameDay.map((a) => `${hm(a.at)} ${a.title}`).join(' · ')}</span>
                </div>
              )}
              {v.status === 'requested' && <VisitDecision visitId={v.id} context={`${context} · ${when}`} />}
            </div>
          </section>
          <aside className="card" aria-labelledby="fv-assign">
            <div className="card-head"><h2 id="fv-assign">{t('portal.team.assignee')}</h2></div>
            <div className="card-body">
              <AssignForm kind="visit" id={v.id} value={v.assigneeId ?? ''} options={people.map((u) => ({ value: u.id, label: `${u.lastName} ${u.firstName}`, hint: u.jobTitle ?? undefined }))} />
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
