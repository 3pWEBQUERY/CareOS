import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { applicableTo, complianceCell, EXPIRING_DAYS, staffInScope, syncExpired, type CellState } from '@/lib/learn'
import { fmtDate } from '@/lib/time'
import { LearnHead, LearnTabs } from '../LearnTabs'
import { AssignButton } from '../LearnClient'

export const metadata = { title: 'Learn · Compliance' }

const SYMBOL: Record<CellState, string> = { valid: '✓', expiring: '!', expired: '✕', overdue: '✕', missing: '○', na: '' }

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ unit?: string; course?: string; only?: string }> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('learn.manage')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const unitId = sp.unit && ctx.unitIds.includes(sp.unit) ? sp.unit : null
  await syncExpired(ctx.org.id)
  const now = new Date()

  const allCourses = await db.course.findMany({ where: { orgId: ctx.org.id }, orderBy: [{ mandatory: 'desc' }, { title: 'asc' }] })
  const extra = sp.course ? allCourses.find((c) => c.id === sp.course && !c.mandatory) : undefined
  const courses = allCourses.filter((c) => (c.mandatory && c.published) || c.id === extra?.id)
  const [staff, allStaff, roles] = await Promise.all([staffInScope(ctx, unitId), staffInScope(ctx), db.role.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: 'asc' } })])
  const ids = staff.map((u) => u.id)
  const [enrollments, certs] = await Promise.all([
    db.enrollment.findMany({ where: { courseId: { in: courses.map((c) => c.id) }, userId: { in: ids } } }),
    db.certificate.findMany({ where: { courseId: { in: courses.map((c) => c.id) }, userId: { in: ids } }, orderBy: { issuedAt: 'desc' } }),
  ])
  const enr = new Map(enrollments.map((e) => [e.userId + ':' + e.courseId, e]))
  const cert = new Map<string, (typeof certs)[number]>()
  for (const c of certs) if (!cert.has(c.userId + ':' + c.courseId)) cert.set(c.userId + ':' + c.courseId, c)

  const grid = staff.map((u) => ({
    u,
    cells: courses.map((c) => complianceCell({ applicable: applicableTo(c, u.roleKeys), cert: cert.get(u.id + ':' + c.id), enrollment: enr.get(u.id + ':' + c.id), course: c }, now)),
  }))
  const only = ['gaps', 'expiring'].includes(sp.only ?? '') ? sp.only : null
  const rows = only === 'gaps' ? grid.filter((r) => r.cells.some((c) => ['expired', 'overdue', 'missing'].includes(c.state)))
    : only === 'expiring' ? grid.filter((r) => r.cells.some((c) => c.state === 'expiring')) : grid
  const all = grid.flatMap((r) => r.cells).filter((c) => c.state !== 'na')
  const n = (s: CellState[]) => all.filter((c) => s.includes(c.state)).length
  const ok = n(['valid', 'expiring'])
  const pct = all.length ? Math.round((ok / all.length) * 100) : 100
  const perCourse = courses.map((_, i) => {
    const cells = grid.map((r) => r.cells[i]).filter((c) => c.state !== 'na')
    const good = cells.filter((c) => c.state === 'valid' || c.state === 'expiring').length
    return { good, total: cells.length, pct: cells.length ? Math.round((good / cells.length) * 100) : 100 }
  })
  const short = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: '2-digit' })
  const cellText = (s: CellState, d: Date | null) => {
    if (s === 'na') return '–'
    if (s === 'missing') return d ? t('learn.cell.dueOn', { date: short(d) }) : t('learn.cell.missing')
    if (s === 'valid' && !d) return t('learn.cell.validNoExpiry')
    return t('learn.cell.' + s, { date: d ? short(d) : '' })
  }
  const href = (p: { unit?: string | null; only?: string | null }) => {
    const u = new URLSearchParams()
    const unit = p.unit === undefined ? unitId : p.unit
    const o = p.only === undefined ? only : p.only
    if (unit) u.set('unit', unit)
    if (o) u.set('only', o)
    if (extra) u.set('course', extra.id)
    const s = u.toString()
    return '/learn/compliance' + (s ? '?' + s : '')
  }
  const unitName = new Map(ctx.units.map((u) => [u.id, u.shortName ?? u.name]))

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <LearnHead
        title={t('learn.compliance.title')}
        sub={t('learn.compliance.sub', { n: staff.length, c: courses.length })}
        actions={
          <AssignButton
            courses={allCourses.filter((c) => c.published).map((c) => ({ id: c.id, title: c.title }))}
            defaultCourse={extra?.id}
            people={allStaff.map((u) => ({ id: u.id, name: `${u.lastName} ${u.firstName}`, unit: u.primaryUnitId ? unitName.get(u.primaryUnitId) ?? null : null }))}
            roles={roles.map((r) => ({ id: r.id, name: r.name }))}
            units={ctx.units.map((u) => ({ id: u.id, name: `${u.location.name} · ${u.name}` }))}
          />
        }
      />
      <LearnTabs ctx={ctx} current="compliance" />
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics">
            <div className="metric"><span className="lbl">{t('learn.compliance.rate')}</span><span className={'val' + (pct < 80 ? ' crit' : pct < 95 ? ' warn' : ' ok')}>{pct} <small>%</small></span><div className="bar"><i className={pct < 80 ? 'crit' : pct < 95 ? 'warn' : 'ok'} style={{ width: pct + '%' }} /></div></div>
            <Link className="metric" href={href({ only: only === 'expiring' ? null : 'expiring' })}><span className="lbl">{t('learn.compliance.expiring', { days: EXPIRING_DAYS })}</span><span className={'val' + (n(['expiring']) ? ' warn' : '')}>{n(['expiring'])}</span></Link>
            <Link className="metric" href={href({ only: only === 'gaps' ? null : 'gaps' })}><span className="lbl">{t('learn.compliance.expired')}</span><span className={'val' + (n(['expired', 'overdue']) ? ' crit' : '')}>{n(['expired', 'overdue'])}</span></Link>
            <Link className="metric" href={href({ only: only === 'gaps' ? null : 'gaps' })}><span className="lbl">{t('learn.compliance.missing')}</span><span className="val">{n(['missing'])}</span></Link>
          </div>

          <div className="row-between">
            <nav className="chips" aria-label={t('learn.compliance.unitFilter')}>
              <Link className="chip" href={href({ unit: null })} aria-current={!unitId ? 'page' : undefined}>{t('learn.compliance.allUnits')}</Link>
              {ctx.units.map((u) => <Link key={u.id} className="chip" href={href({ unit: u.id })} aria-current={unitId === u.id ? 'page' : undefined}>{u.name}</Link>)}
            </nav>
            <nav className="chips" aria-label={t('common.filter')}>
              <Link className="chip" href={href({ only: null })} aria-current={!only ? 'page' : undefined}>{t('learn.compliance.everyone')}</Link>
              <Link className="chip" href={href({ only: 'gaps' })} aria-current={only === 'gaps' ? 'page' : undefined}>{t('learn.compliance.onlyGaps')}</Link>
              <Link className="chip" href={href({ only: 'expiring' })} aria-current={only === 'expiring' ? 'page' : undefined}>{t('learn.compliance.onlyExpiring')}</Link>
            </nav>
          </div>

          {courses.length && rows.length ? (
            <div className="tablewrap">
              <table className="stable matrix">
                <thead>
                  <tr>
                    <th scope="col">{t('learn.col.person')}</th>
                    {courses.map((c) => <th key={c.id} scope="col"><Link href={`/learn/${c.id}`} style={{ color: 'inherit' }}>{c.title}</Link>{c.validityMonths && <div className="mono" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{t('learn.validityShort', { n: c.validityMonths })}</div>}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ u, cells }) => (
                    <tr key={u.id}>
                      <th scope="row">
                        <div>{u.lastName} {u.firstName}</div>
                        <div className="small muted" style={{ fontWeight: 400 }}>{[u.jobTitle, u.primaryUnitId && unitName.get(u.primaryUnitId)].filter(Boolean).join(' · ')}</div>
                      </th>
                      {cells.map((c, i) => (
                        <td key={courses[i].id}>
                          <span className={'cm ' + c.state}><span aria-hidden="true">{SYMBOL[c.state]}</span>{cellText(c.state, c.date)}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="lbl">{t('learn.compliance.perCourse')}</th>
                    {perCourse.map((p, i) => (
                      <td key={courses[i].id}>
                        <div className={'mono ' + (p.pct < 80 ? 'crit-text' : p.pct < 95 ? 'warn-text' : 'ok-text')}>{p.pct} %</div>
                        <div className="small muted">{t('learn.compliance.xOfY', { x: p.good, y: p.total })}</div>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : <Empty title={courses.length ? t('learn.compliance.emptyRows') : t('learn.compliance.noMandatory')} />}

          <div className="mlegend">
            {(['valid', 'expiring', 'expired', 'overdue', 'missing'] as const).map((s) => <span key={s}><span className={'cm ' + s}><span aria-hidden="true">{SYMBOL[s]}</span>{t('learn.legend.' + s)}</span></span>)}
          </div>
        </div>
      </div>
    </main>
  )
}
