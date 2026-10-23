import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { exportRateLimit } from '@/lib/rate-limit'
import { monthRange } from '@/lib/billing-core'
import { toCsv } from '@/lib/import/csv'
import { dateKey, fromDbDate } from '@/lib/time'
import { KLV_KEYS, hours, klvTotals, proofCsvRows } from '@/lib/spitex'
import { monthVisits, pickUnit } from '@/lib/spitex-data'
import { userNames } from '@/app/(app)/residents/_lib/resident'

/**
 * GET /spitex/proof/export?u=&m=YYYY-MM[&r=] – Leistungsnachweis als CSV (PRD §40): mit r je Einsatz der Person
 * (Datum, Zeit, Person, Leistungen, Minuten KLV a/b/c), sonst eine Zeile je Klient/in mit Monatssummen.
 * Modul «Spitex», Leserecht im Einsatzgebiet, Rate-Limit wie der Abrechnungsexport; jeder Export wird protokolliert.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.hasModule('spitex')) return NextResponse.json({ error: 'module_inactive' }, { status: 403 })
  const { unit } = pickUnit(ctx, req.nextUrl.searchParams.get('u'))
  if (!unit) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const month = req.nextUrl.searchParams.get('m') ?? ''
  const range = monthRange(month)
  if (!range) return NextResponse.json({ error: 'month' }, { status: 400 })
  const rl = await exportRateLimit('billing', ctx.user.id)
  if (!rl.ok) return NextResponse.json({ error: 'rate' }, { status: 429, headers: { 'retry-after': String(rl.retryAfter) } })
  const rid = req.nextUrl.searchParams.get('r')
  const client = rid ? await db.resident.findFirst({ where: { id: rid, orgId: ctx.org.id, unitId: unit.id }, select: { id: true, firstName: true, lastName: true, birthDate: true, insuranceNo: true } }) : null
  if (rid && !client) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const visits = await monthVisits(ctx.org.id, [unit.id], range.start, range.end, client?.id)
  const col = (k: string, v?: Record<string, string>) => t('spitex.proof.csv.' + k, v)
  let rows: string[][]
  if (client) {
    const names = await userNames(ctx, visits.map((v) => v.doneById ?? v.assigneeId))
    rows = proofCsvRows(
      visits.map((v) => ({ date: fromDbDate(v.date), start: v.actualStart ?? v.plannedStart, end: v.actualEnd ?? v.plannedEnd, staff: names.get(v.doneById ?? v.assigneeId ?? '')?.short ?? '', services: v.services })),
      { header: [col('date'), col('start'), col('end'), col('staff'), col('services'), ...KLV_KEYS.map((k) => col('klv', { k })), col('total')], total: col('sum'), dateKey },
    )
  } else {
    const residents = await db.resident.findMany({ where: { orgId: ctx.org.id, id: { in: [...new Set(visits.map((v) => v.residentId))] } }, select: { id: true, firstName: true, lastName: true, birthDate: true, insuranceNo: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] })
    rows = [[col('lastName'), col('firstName'), col('birthDate'), col('insuranceNo'), col('visits'), ...KLV_KEYS.map((k) => col('klv', { k })), col('total'), col('hours')]]
    for (const r of residents) {
      const x = klvTotals(visits.filter((v) => v.residentId === r.id))
      rows.push([r.lastName, r.firstName, dateKey(fromDbDate(r.birthDate)), r.insuranceNo ?? '', String(x.visits), String(x.a), String(x.b), String(x.c), String(x.total), hours(x.total)])
    }
  }
  await audit(ctx, { action: 'spitex.proof.export', entityType: client ? 'Resident' : 'Unit', entityId: client?.id ?? unit.id, after: { month, rows: rows.length - 1 }, context: { unitId: unit.id, ...(client ? { residentId: client.id } : {}) } })
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '')
  const file = `careos-leistungsnachweis-${month}-${client ? slug(client.lastName) : slug(unit.shortName ?? unit.name)}.csv`
  return new NextResponse(toCsv(rows), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${file}"`, 'cache-control': 'private, no-store' },
  })
}
