import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, dbDate } from '@/lib/time'
import type { HomeView } from '@/lib/home-view'
import { HomeHead } from './Head'
import { ForYou } from './ForYou'
import { leadDecisions, staffing } from './overview'

type Item = { key: string; label: string; n: number; href: string; tone: 'warn' | 'crit' }

/**
 * Verwaltungsansicht (PRD §4.6) für HR, Administration und Systemadministration: nur, was die eigenen Berechtigungen
 * betreffen – keine klinischen Blöcke, keine Links in Bereiche ohne Zugriff.
 */
export async function OfficeHome({ ctx, now, greet, view, views }: { ctx: Ctx; now: Date; greet: string; view: HomeView; views: HomeView[] }) {
  const { t } = ctx
  const can = ctx.can
  const canSchedule = can('schedule.manage')
  const canLearn = can('learn.manage')
  const canUsers = can('admin.users')
  const canAudit = can('admin.audit')
  const canPlatform = can('admin.org') || can('admin.integrations')
  const day = addDays(now, -1)
  const [decisions, openShifts, trainings, certs, noMfa, failedLogins, jobs, hooks, docs, staff] = await Promise.all([
    canSchedule ? leadDecisions(ctx, ctx.unitIds, now) : null,
    canSchedule ? db.shift.count({ where: { unitId: { in: ctx.unitIds }, status: 'open', date: { gte: dbDate(now), lte: dbDate(addDays(now, 14)) } } }) : 0,
    canLearn ? db.enrollment.count({ where: { status: { not: 'completed' }, dueAt: { lt: now }, course: { orgId: ctx.org.id, mandatory: true }, user: { active: true } } }) : 0,
    canLearn ? db.certificate.count({ where: { expiresAt: { gte: now, lte: addDays(now, 60) }, user: { orgId: ctx.org.id, active: true } } }) : 0,
    canUsers ? db.user.count({ where: { orgId: ctx.org.id, active: true, mfaEnabled: false } }) : 0,
    canAudit ? db.auditLog.count({ where: { orgId: ctx.org.id, action: { in: ['auth.login_failed', 'auth.mfa_failed'] }, at: { gte: day } } }) : 0,
    canPlatform ? db.jobRun.count({ where: { ok: false, startedAt: { gte: day }, OR: [{ orgId: null }, { orgId: ctx.org.id }] } }) : 0,
    can('admin.integrations') ? db.webhookDelivery.count({ where: { createdAt: { gte: day }, OR: [{ error: { not: null } }, { status: { gte: 400 } }], webhook: { orgId: ctx.org.id } } }) : 0,
    can('docs.approve') ? db.document.count({ where: { orgId: ctx.org.id, status: 'review' } }) : 0,
    can('schedule.read') ? staffing(ctx.unitIds, now) : [],
  ])
  const items: Item[] = [
    ...(decisions ? [
      { key: 'abs', label: t('home.lead.absences', { n: decisions.absences }), n: decisions.absences, href: '/schedule?view=absences', tone: 'warn' as const },
      { key: 'swap', label: t('home.lead.swaps', { n: decisions.swaps }), n: decisions.swaps, href: '/schedule?view=swaps', tone: 'warn' as const },
      { key: 'open', label: t('home.office.openShifts', { n: openShifts }), n: openShifts, href: '/schedule?view=open', tone: 'warn' as const },
    ] : []),
    ...(canLearn ? [
      { key: 'learn', label: t('home.office.trainingsOverdue', { n: trainings }), n: trainings, href: '/learn/compliance', tone: 'crit' as const },
      { key: 'cert', label: t('home.office.certsExpiring', { n: certs }), n: certs, href: '/learn/compliance', tone: 'warn' as const },
    ] : []),
    ...(can('docs.approve') ? [{ key: 'docs', label: t('home.office.docsReview', { n: docs }), n: docs, href: '/docs', tone: 'warn' as const }] : []),
    ...(canUsers ? [{ key: 'mfa', label: t('home.office.noMfa', { n: noMfa }), n: noMfa, href: '/admin/users', tone: 'warn' as const }] : []),
    ...(canAudit ? [{ key: 'login', label: t('home.office.failedLogins', { n: failedLogins }), n: failedLogins, href: '/admin/audit', tone: 'warn' as const }] : []),
    ...(canPlatform ? [{ key: 'jobs', label: t('home.office.jobsFailed', { n: jobs }), n: jobs, href: '/admin', tone: 'crit' as const }] : []),
    ...(can('admin.integrations') ? [{ key: 'hooks', label: t('home.office.webhooksFailed', { n: hooks }), n: hooks, href: '/admin/integrations', tone: 'crit' as const }] : []),
  ]
  const attention = items.filter((i) => i.n > 0)
  const quiet = items.filter((i) => i.n === 0)
  const unitName = (id: string) => ctx.units.find((u) => u.id === id)?.name ?? ''

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <HomeHead t={t} view={view} views={views} greet={greet} label={ctx.org.name} sub={ctx.user.jobTitle ?? ctx.roleNames.join(', ')} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
            <div className="stack">
              {items.length > 0 && (
                <section className={'card' + (attention.length ? ' warn' : '')} aria-labelledby="office-todo">
                  <div className="card-head"><h2 id="office-todo">{t('home.office.todo')}</h2><span className={'pill ' + (attention.length ? 'warn' : '')}>{attention.length}</span></div>
                  <ul className="list">
                    {attention.map((i) => (
                      <li key={i.key}><Link className="li" href={i.href}><span className={'grow ' + (i.tone === 'crit' ? 'crit-text' : '')}>{i.label}</span><span className="muted" aria-hidden="true">→</span></Link></li>
                    ))}
                  </ul>
                  {!attention.length && <div className="card-body small muted">{t('home.office.nothing')}</div>}
                  {quiet.length > 0 && (
                    <div className="card-body small muted home-quiet">
                      {quiet.map((i) => i.label).join(' · ')}
                    </div>
                  )}
                </section>
              )}
              {staff.length > 0 && (
                <section className="card" aria-labelledby="office-staff">
                  <div className="card-head"><h2 id="office-staff">{t('home.office.staffing')}</h2>{can('schedule.read') && <Link className="linkbtn small" href="/schedule">{t('nav.schedule')} →</Link>}</div>
                  <ul className="list">
                    {staff.map((s) => (
                      <li key={s.unitId}>
                        <div className="li">
                          <span className="grow">{unitName(s.unitId)}</span>
                          <span className="mono small">{s.byCode.length ? s.byCode.map((c) => `${c.code} ${c.n}`).join(' · ') : '–'}</span>
                          {s.openWeek > 0 && <span className="tag warn">{t('home.lead.openShifts', { n: s.openWeek })}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            <div className="stack">
              <ForYou ctx={ctx} now={now} unitId={null} />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
