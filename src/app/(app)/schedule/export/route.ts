import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { exportRateLimit } from '@/lib/rate-limit'
import { toCsv } from '@/lib/import/csv'
import { loadRoster, MONTH_RE } from '@/lib/roster/server'
import { evaluate } from '@/lib/roster/evaluate'
import { payrollRows } from '@/lib/roster-export'

/**
 * GET /schedule/export?unitId=&m=YYYY-MM – Stunden eines Monats für die Lohnbuchhaltung als CSV (PRD §19): je Person
 * Personalnummer, Pensum, Soll, geplante Stunden, Saldo, Nachtdienste, Wochenendtage und genehmigte Abwesenheitstage je Art.
 * Zahlen aus loadRoster/evaluate wie in der Monatsplanung. Leitung mit schedule.manage im Bereich, Rate-Limit je Person
 * (EXPORT_LIMITS); jeder Export wird protokolliert (Audit «schedule.payroll.export»).
 */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.hasModule('schedule')) return NextResponse.json({ error: 'module_inactive' }, { status: 403 })
  const sp = req.nextUrl.searchParams
  const unit = ctx.units.find((u) => u.id === sp.get('unitId'))
  if (!unit || !ctx.can('schedule.manage', { unitId: unit.id, locationId: unit.locationId })) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const month = sp.get('m') ?? ''
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: 'month' }, { status: 400 })
  const rl = await exportRateLimit('payroll', ctx.user.id)
  if (!rl.ok) return NextResponse.json({ error: 'rate' }, { status: 429, headers: { 'retry-after': String(rl.retryAfter) } })

  const data = await loadRoster(ctx.org.id, ctx.org.settings, unit.id, month)
  const ev = evaluate(data.problem, data.current)
  const users = await db.user.findMany({ where: { id: { in: data.people.map((p) => p.id) }, orgId: ctx.org.id }, select: { id: true, employeeNo: true } })
  const empNo = new Map(users.map((u) => [u.id, u.employeeNo]))
  const c = (k: string) => t('roster.payroll.cols.' + k)
  const rows = payrollRows(
    { person: c('person'), employeeNo: c('employeeNo'), pct: c('pct'), soll: c('soll'), ist: c('ist'), diff: c('diff'), nights: c('nights'), weekends: c('weekends'), absence: (k) => t('roster.payroll.cols.absence', { kind: t('schedule.absence.kinds.' + k) }) },
    data.people.map((p) => ({ id: p.id, name: p.name, employeeNo: empNo.get(p.id) ?? null, pct: p.pct })),
    ev.people,
    data.problem.days,
    data.absenceAt,
  )
  await audit(ctx, { action: 'schedule.payroll.export', entityType: 'Unit', entityId: unit.id, after: { month, rows: rows.length - 1 }, context: { unitId: unit.id } })
  return new NextResponse(toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="careos-lohn-${(unit.shortName ?? unit.name).replace(/[^\w-]+/g, '')}-${month}.csv"`,
      'cache-control': 'private, no-store',
    },
  })
}
