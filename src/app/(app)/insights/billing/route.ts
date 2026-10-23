import { NextResponse, type NextRequest } from 'next/server'
import { getCtx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { exportRateLimit } from '@/lib/rate-limit'
import { billingCsvRows, billingRows, monthRange } from '@/lib/billing'
import { toCsv } from '@/lib/import/csv'
import { categoryLabel } from '@/lib/care'

/**
 * GET /insights/billing?month=YYYY-MM[&unit=] – Abrechnungsexport als CSV (PRD §40): je Person Pflegestufe,
 * Aufenthalts- und Abwesenheitstage, dokumentierte Pflegeminuten und Leistungen je Kategorie. Modul «Kennzahlen»,
 * Berechtigung «Kennzahlen» im Bereich, Rate-Limit je Person (EXPORT_LIMITS); jeder Export wird protokolliert
 * (Audit «billing.export»).
 */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.hasModule('insights')) return NextResponse.json({ error: 'module_inactive' }, { status: 403 })
  const units = ctx.units.filter((u) => ctx.can('insights.view', { unitId: u.id, locationId: u.locationId }))
  if (!units.length) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const rl = await exportRateLimit('billing', ctx.user.id)
  if (!rl.ok) return NextResponse.json({ error: 'rate' }, { status: 429, headers: { 'retry-after': String(rl.retryAfter) } })
  const month = req.nextUrl.searchParams.get('month') ?? ''
  if (!monthRange(month)) return NextResponse.json({ error: 'month' }, { status: 400 })
  const unit = units.find((u) => u.id === req.nextUrl.searchParams.get('unit'))
  const unitIds = unit ? [unit.id] : units.map((u) => u.id)
  const rows = await billingRows(ctx.org.id, unitIds, month)
  const base = ['lastName', 'firstName', 'birthDate', 'insuranceNo', 'unit', 'careLevel', 'stayDays', 'absenceDays', 'careMinutes', 'careHours', 'services'].map((k) => t('insights.billing.cols.' + k))
  const csv = toCsv(billingCsvRows(rows, { base, category: (c) => t('insights.billing.cols.category', { name: categoryLabel(t, c) }) }))
  await audit(ctx, { action: 'billing.export', entityType: 'Organization', entityId: ctx.org.id, after: { month, rows: rows.length }, context: { unitIds } })
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="careos-abrechnung-${month}${unit ? '-' + (unit.shortName ?? unit.name).replace(/[^\w-]+/g, '') : ''}.csv"`,
      'cache-control': 'private, no-store',
    },
  })
}
