import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { OPEN_STATUSES } from '@/lib/tasks'
import { addDays, addMinutes, age, fmtNum, fmtRel, startOfDay } from '@/lib/time'
import { abnormalKeys, flag, mergeLimits, VITALS } from '@/lib/vitals'
import { Admit } from './Admit'

export const metadata = { title: 'Residents' }

/** Einheitenübersicht, wenn keine Person gewählt ist. */
export default async function ResidentsPage({ searchParams }: { searchParams: Promise<{ pick?: string }> }) {
  const ctx = await getCtx()
  const { t, unit, locale } = ctx
  if (!ctx.can('resident.read')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const pick = sp.pick === 'notes' || sp.pick === 'vitals' ? sp.pick : null
  const unitIds = unit ? [unit.id] : ctx.unitIds
  const now = new Date()
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)

  const residents = await db.resident.findMany({
    where: { orgId: ctx.org.id, unitId: { in: unitIds }, status: { in: ['active', 'absent'] } },
    include: { room: true },
    orderBy: [{ room: { number: 'asc' } }, { lastName: 'asc' }],
  })
  const ids = residents.map((r) => r.id)
  const [open, over, vitals, limitRows, lastNotes, rooms] = await Promise.all([
    db.task.groupBy({ by: ['residentId'], where: { residentId: { in: ids }, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addDays(startOfDay(now), 1) } }, _count: true }),
    db.task.groupBy({ by: ['residentId'], where: { residentId: { in: ids }, status: { in: [...OPEN_STATUSES] }, dueAt: { gte: startOfDay(now), lt: addMinutes(now, -15) } }, _count: true }),
    db.vitalSign.findMany({ where: { residentId: { in: ids }, at: { gte: addDays(now, -1) } }, orderBy: { at: 'desc' } }),
    db.vitalThreshold.findMany({ where: { orgId: ctx.org.id } }),
    db.observation.groupBy({ by: ['residentId'], where: { residentId: { in: ids } }, _max: { at: true } }),
    unit ? db.room.findMany({ where: { unitId: unit.id }, include: { residents: { where: { status: { in: ['active', 'absent'] } }, select: { id: true } } }, orderBy: { number: 'asc' } }) : [],
  ])
  const cnt = (rows: { residentId: string | null; _count: number }[], id: string) => rows.find((r) => r.residentId === id)?._count ?? 0
  const latest = new Map<string, (typeof vitals)[number]>()
  for (const v of vitals) if (!latest.has(v.residentId)) latest.set(v.residentId, v)
  const freeRooms = rooms.filter((r) => r.residents.length < r.beds).map((r) => ({ id: r.id, label: `${r.number}${r.beds > 1 ? ` (${r.residents.length}/${r.beds})` : ''}` }))
  const canAdmit = !!unit && ctx.canHere('resident.create')

  return (
    <main className="panel main">
      <div className="view-head">
        <div>
          <span className="lbl">{unit ? unit.location.name : ctx.org.name}</span>
          <h1>{unit ? unit.name : t('residents.list.title')}</h1>
          <p className="sub">{t('residents.unit.count', { n: residents.length })}{unit && rooms.length ? ' · ' + t('residents.unit.freeRooms', { n: freeRooms.length }) : ''}</p>
        </div>
        {canAdmit && <Admit rooms={freeRooms} unitName={unit!.name} />}
      </div>
      <div className="scroll">
        <div className="tabpanel">
          {pick && (
            <div className="alert info" role="status">
              <span className="grow">{t(pick === 'vitals' ? 'residents.unit.pickVitals' : 'residents.unit.pickNotes')}</span>
            </div>
          )}
          {residents.length ? (
            <div className="tablewrap">
              <table className="stable">
                <thead>
                  <tr>
                    <th>{t('residents.banner.room')}</th>
                    <th>{t('residents.unit.name')}</th>
                    <th className="right">{t('residents.unit.age')}</th>
                    <th className="right">{t('residents.banner.careLevel')}</th>
                    <th>{t('residents.unit.tasks')}</th>
                    <th>{t('residents.unit.vitals')}</th>
                    <th>{t('residents.unit.lastNote')}</th>
                  </tr>
                </thead>
                <tbody>
                  {residents.map((r) => {
                    const v = latest.get(r.id)
                    const lim = mergeLimits(limitRows.filter((l) => !l.residentId || l.residentId === r.id), r.id)
                    const ab = abnormalKeys(v, lim)
                    const o = cnt(open, r.id)
                    const ov = cnt(over, r.id)
                    const ln = lastNotes.find((n) => n.residentId === r.id)?._max.at
                    const href = `/residents/${r.id}${pick ? '/' + pick : ''}`
                    return (
                      <tr key={r.id} className={'clickable' + (ov ? ' over' : '')}>
                        <td className="num">{r.room?.number ?? '–'}</td>
                        <td>
                          <Link href={href} style={{ color: 'inherit', fontWeight: 500 }}>{r.lastName} {r.firstName}</Link>
                          <div className="row" style={{ gap: 4, marginTop: 2 }}>
                            {r.status === 'absent' && <span className="tag accent">{t('residents.banner.absent')}</span>}
                            {r.allergies.length > 0 && <span className="tag crit">{t('residents.list.allergy')}</span>}
                            {r.rea === 'no' && <span className="tag outline">{t('residents.list.reaNo')}</span>}
                            {r.risks.slice(0, 2).map((x) => <span key={x} className="tag warn">{x}</span>)}
                          </div>
                        </td>
                        <td className="num right">{age(r.birthDate)}</td>
                        <td className="num right">{r.careLevel ?? '–'}</td>
                        <td className="nowrap">
                          {ov > 0 && <span className="pill crit" style={{ marginRight: 4 }}>{t('residents.unit.overdueN', { n: ov })}</span>}
                          <span className={'pill' + (o ? '' : ' ok')}>{o ? t('residents.unit.openN', { n: o }) : '✓ ' + t('residents.unit.allDone')}</span>
                        </td>
                        <td className="small">
                          {ab.length ? (
                            <span className="crit-text">
                              {ab.map((k) => `${t('common.vitals.' + k)} ${fmtNum(v![k] as number, VITALS[k].dec, locale)}${flag(k, v![k], lim) === 'hi' ? ' ▲' : ' ▼'}`).join(' · ')}
                            </span>
                          ) : v ? <span className="muted">{t('residents.unit.vitalsOk')}</span> : <span className="muted">{t('residents.unit.noVitals')}</span>}
                        </td>
                        <td className="num small nowrap">{ln ? rel(ln) : '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">{t('residents.unit.empty')}</p>
          )}
        </div>
      </div>
    </main>
  )
}
