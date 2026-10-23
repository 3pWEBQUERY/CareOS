import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { monthRange } from '@/lib/billing-core'
import { fmtDate, fmtDbDate, fromDbDate, hm } from '@/lib/time'
import { KLV_KEYS, addressLine, hours, klvTotals, serviceMinutes } from '@/lib/spitex'
import { monthVisits, pickUnit } from '@/lib/spitex-data'
import { userNames } from '@/app/(app)/residents/_lib/resident'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { Select } from '@/components/ui/fields'
import { SpitexHead } from '../_ui/SpitexHead'
import { PrintButton } from './PrintButton'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('nav.spitex') + ' · ' + t('spitex.tabs.proof') }
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * Leistungsnachweis (PRD §40 Abrechnung): je Klient/in und Monat die erbrachten Minuten nach KLV a/b/c aus
 * abgeschlossenen Einsätzen. Übersicht des Einsatzgebiets, Einzelnachweis druckbar, beides als CSV.
 */
export default async function ProofPage({ searchParams }: { searchParams: Promise<{ u?: string; m?: string; r?: string }> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.hasModule('spitex')) return <Forbidden text={t('common.moduleOff')} />
  const { unit } = pickUnit(ctx, sp.u)
  if (!unit) return <Forbidden text={t('common.notAllowed')} />
  const now = new Date()
  const months = Array.from({ length: 13 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1))
  const month = sp.m && monthRange(sp.m) ? sp.m : monthKey(now)
  const { start, end } = monthRange(month)!
  const monthLabel = fmtDate(start, locale, { month: 'long', year: 'numeric' })
  const client = sp.r ? await db.resident.findFirst({ where: { id: sp.r, orgId: ctx.org.id, unitId: unit.id }, select: { id: true, firstName: true, lastName: true, birthDate: true, insuranceNo: true, street: true, postalCode: true, city: true } }) : null
  const visits = await monthVisits(ctx.org.id, [unit.id], start, end, client?.id)
  const q = (extra: Record<string, string>) => '?' + new URLSearchParams({ u: unit.id, m: month, ...extra }).toString()

  const picker = (
    <form method="get" className="row sx-month no-print" style={{ alignItems: 'end', gap: 8 }}>
      <input type="hidden" name="u" value={unit.id} />
      {client && <input type="hidden" name="r" value={client.id} />}
      <Select label={t('spitex.proof.month')} name="m" defaultValue={month} wrapStyle={{ minWidth: 190 }}>
        {months.map((m) => <option key={monthKey(m)} value={monthKey(m)}>{fmtDate(m, locale, { month: 'long', year: 'numeric' })}{monthKey(m) === monthKey(now) ? ' · ' + t('spitex.proof.running') : ''}</option>)}
      </Select>
      <button type="submit" className="btn">{t('spitex.proof.show')}</button>
    </form>
  )

  if (client) {
    const names = await userNames(ctx, visits.map((v) => v.doneById ?? v.assigneeId))
    const totals = klvTotals(visits)
    const name = `${client.lastName} ${client.firstName}`
    return (
      <main className="panel main sx sx-proof" style={{ flex: 1 }}>
        <SpitexHead ctx={ctx} current="proof" title={t('spitex.proof.titleClient', { name })} where={unit.name} unitId={unit.id}
          actions={<>
            <Link className="btn ghost no-print" href={'/spitex/proof' + q({})}>{t('spitex.proof.back')}</Link>
            <a className="btn no-print" href={'/spitex/proof/export' + q({ r: client.id })}>{t('spitex.proof.csvClient')}</a>
            <PrintButton label={t('spitex.proof.print')} />
          </>} />
        <div className="scroll">
          <div className="tabpanel">
            {picker}
            <section className="card sx-proof-doc" aria-labelledby="sx-proof-h">
              <div className="card-head">
                <h2 id="sx-proof-h">{t('spitex.proof.docTitle', { month: monthLabel })}</h2>
                <span className="small muted">{ctx.org.name} · {unit.name}</span>
              </div>
              <div className="card-body stack-sm">
                <dl className="kv">
                  <dt>{t('spitex.proof.client')}</dt><dd>{name}</dd>
                  <dt>{t('spitex.proof.birthDate')}</dt><dd className="mono">{fmtDbDate(client.birthDate, locale)}</dd>
                  <dt>{t('spitex.proof.insuranceNo')}</dt><dd className="mono">{client.insuranceNo || '–'}</dd>
                  <dt>{t('spitex.clients.address')}</dt><dd>{addressLine(client) || '–'}</dd>
                </dl>
                <div className="metrics">
                  {KLV_KEYS.map((k) => (
                    <div key={k} className="metric"><span className="lbl">{t('spitex.klvShort.' + k)}</span><span className="val">{totals[k]}<small> {t('spitex.min')}</small></span><span className="small muted">{t('spitex.klv.' + k)}</span></div>
                  ))}
                  <div className="metric"><span className="lbl">{t('spitex.proof.total')}</span><span className="val">{hours(totals.total)}<small> h</small></span><span className="small muted">{t('spitex.visitsN', { n: totals.visits })}</span></div>
                </div>
              </div>
            </section>
            {visits.length ? (
              <div className="tablewrap rwrap">
                <table className="stable rtable sx-proof-table">
                  <thead><tr><th>{t('spitex.proof.col.date')}</th><th>{t('spitex.proof.col.time')}</th><th>{t('spitex.proof.col.staff')}</th><th>{t('spitex.proof.col.services')}</th>{KLV_KEYS.map((k) => <th key={k} className="right">{k}</th>)}<th className="right">{t('spitex.proof.col.total')}</th></tr></thead>
                  <tbody>
                    {visits.map((v) => {
                      const m = Object.fromEntries(KLV_KEYS.map((k) => [k, v.services.filter((s) => s.klv === k).reduce((a, s) => a + serviceMinutes(s), 0)]))
                      return (
                        <tr key={v.id}>
                          <td className="mono nowrap">{fmtDate(fromDbDate(v.date), locale, { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
                          <td className="mono nowrap" data-label={t('spitex.proof.col.time')}>{v.actualStart ? hm(v.actualStart) : '–'}–{v.actualEnd ? hm(v.actualEnd) : '–'}</td>
                          <td data-label={t('spitex.proof.col.staff')}>{names.get(v.doneById ?? v.assigneeId ?? '')?.short ?? '–'}</td>
                          <td className="small" data-label={t('spitex.proof.col.services')}>{v.services.filter((s) => s.done).map((s) => `${s.label} (${s.klv}, ${serviceMinutes(s)}′)`).join(' · ') || '–'}</td>
                          {KLV_KEYS.map((k) => <td key={k} className="num right" data-label={t('spitex.klvShort.' + k)}>{m[k]}</td>)}
                          <td className="num right" data-label={t('spitex.proof.col.total')}>{KLV_KEYS.reduce((a, k) => a + m[k], 0)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr><th colSpan={4}>{t('spitex.proof.total')}</th>{KLV_KEYS.map((k) => <td key={k} className="num right" data-label={t('spitex.klvShort.' + k)}>{totals[k]}</td>)}<td className="num right" data-label={t('spitex.proof.col.total')}>{totals.total}</td></tr>
                  </tfoot>
                </table>
              </div>
            ) : <Empty title={t('spitex.proof.noneClient', { month: monthLabel })} />}
            <p className="small muted sx-proof-note">{t('spitex.proof.note')}</p>
          </div>
        </div>
      </main>
    )
  }

  const residents = await db.resident.findMany({
    where: { orgId: ctx.org.id, OR: [{ unitId: unit.id, status: { in: ['active', 'absent'] } }, { id: { in: visits.map((v) => v.residentId) } }] },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  const rows = residents.map((r) => ({ r, totals: klvTotals(visits.filter((v) => v.residentId === r.id)) }))
  const all = klvTotals(visits)

  return (
    <main className="panel main sx" style={{ flex: 1 }}>
      <SpitexHead ctx={ctx} current="proof" title={t('spitex.proof.title')} where={unit.name} unitId={unit.id}
        actions={<a className="btn" href={'/spitex/proof/export' + q({})}>{t('spitex.proof.csvAll')}</a>} />
      <div className="scroll">
        <div className="tabpanel">
          {picker}
          <div className="metrics">
            {KLV_KEYS.map((k) => <div key={k} className="metric"><span className="lbl">{t('spitex.klvShort.' + k)}</span><span className="val">{hours(all[k])}<small> h</small></span></div>)}
            <div className="metric"><span className="lbl">{t('spitex.proof.total')}</span><span className="val">{hours(all.total)}<small> h</small></span><span className="small muted">{t('spitex.visitsN', { n: all.visits })}</span></div>
          </div>
          {rows.length ? (
            <div className="tablewrap rwrap">
              <table className="stable rtable">
                <thead><tr><th>{t('spitex.proof.client')}</th><th className="right">{t('spitex.proof.col.visits')}</th>{KLV_KEYS.map((k) => <th key={k} className="right">{t('spitex.proof.col.klvMin', { k })}</th>)}<th className="right">{t('spitex.proof.col.hours')}</th><th className="right"><span className="sr-only">{t('spitex.proof.col.actions')}</span></th></tr></thead>
                <tbody>
                  {rows.map(({ r, totals }) => (
                    <tr key={r.id}>
                      <td>{`${r.lastName} ${r.firstName}`}</td>
                      <td className="num right" data-label={t('spitex.proof.col.visits')}>{totals.visits}</td>
                      {KLV_KEYS.map((k) => <td key={k} className="num right" data-label={t('spitex.proof.col.klvMin', { k })}>{totals[k]}</td>)}
                      <td className="num right" data-label={t('spitex.proof.col.hours')}>{hours(totals.total)}</td>
                      <td className="right"><Link className="btn sm" href={'/spitex/proof' + q({ r: r.id })} aria-label={t('spitex.proof.openNamed', { name: `${r.lastName} ${r.firstName}` })}>{t('spitex.proof.open')}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title={t('spitex.clients.none')} />}
          <p className="small muted">{t('spitex.proof.note')}</p>
        </div>
      </div>
    </main>
  )
}
