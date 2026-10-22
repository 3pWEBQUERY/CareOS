import Link from 'next/link'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { age, hm } from '@/lib/time'
import { toLocalInput, workflowSteps } from '../_lib'
import { ReportForm } from './ReportForm'

export const metadata = { title: 'Quality' }

export default async function NewIncidentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCtx()
  const { t } = ctx
  const units = ctx.units.filter((u) => ctx.can('quality.report', { unitId: u.id, locationId: u.locationId }))
  if (!units.length) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  // Personenbezug: ?resident=… oder – beim Melden über die Schnellaktion aus einer Akte – die zuletzt geöffnete Akte.
  const fromReferer = /\/residents\/([^/?#]+)/.exec((await headers()).get('referer') ?? '')?.[1] ?? ''
  const wanted = typeof sp.resident === 'string' ? sp.resident : fromReferer
  const readableUnits = units.filter((u) => ctx.can('resident.read', { unitId: u.id, locationId: u.locationId }))

  const [types, residents] = await Promise.all([
    db.incidentType.findMany({ where: { orgId: ctx.org.id, active: true }, orderBy: { name: 'asc' } }),
    readableUnits.length
      ? db.resident.findMany({
          where: { orgId: ctx.org.id, unitId: { in: readableUnits.map((u) => u.id) }, status: { in: ['active', 'absent'] } },
          include: { room: true, unit: true },
          orderBy: [{ unit: { name: 'asc' } }, { room: { number: 'asc' } }, { lastName: 'asc' }],
        })
      : [],
  ])
  // Bevorzugte Reihenfolge: häufige Ereignisse zuerst, Rest alphabetisch
  const order = ['fall', 'medication', 'pressure', 'injury', 'aggression', 'nearmiss', 'technical']
  types.sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99) || a.name.localeCompare(b.name))

  const defaultUnit = units.find((u) => u.id === ctx.unit?.id)?.id ?? units[0].id
  return (
    <main className="panel main q-new" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">CareOS Quality</span>
          <h1>{t('quality.report.title')}</h1>
          <p className="sub">{t('quality.report.subtitle')}</p>
        </div>
        <Link className="btn ghost" href="/quality">{t('common.cancel')}</Link>
      </div>
      <div className="scroll">
        <div className="tabpanel" style={{ maxWidth: 920 }}>
          <ReportForm
            now={toLocalInput(new Date())}
            nowLabel={t('quality.ux.now', { time: hm(new Date()) })}
            defaultUnitId={defaultUnit}
            defaultResidentId={residents.some((r) => r.id === wanted) ? wanted : ''}
            units={units.map((u) => ({ id: u.id, name: u.name }))}
            types={types.map((x) => ({
              id: x.id,
              key: x.key,
              name: x.name,
              steps: workflowSteps(x).map((s) => ({ key: s.key, title: s.title, offsetMin: s.offsetMin })),
            }))}
            residents={residents.map((r) => ({
              id: r.id,
              name: `${r.lastName} ${r.firstName}`,
              room: r.room?.number ?? null,
              age: age(r.birthDate),
              unitId: r.unitId,
              unitName: r.unit.name,
              risks: r.risks,
            }))}
          />
        </div>
      </div>
    </main>
  )
}
