import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { dailyUnits, stockDays } from '@/lib/medication'
import { COVER_DAYS, expiryState, REORDER_AT_DAYS, reorderSuggestion } from '@/lib/pharmacy'
import { dateKey, fmtDate, fmtDayMonth, hm } from '@/lib/time'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { CancelOrder, CopyOrderList, CountButton, ReceiveButton, SuggestTable, type SuggestDto } from './PharmacyClient'

export async function generateMetadata() {
  return { title: (await getCtx()).t('meds.pharmacy.title') }
}

/**
 * Apotheke im Bereich (PRD §13.1 Bestandsmanagement, §40): Bestellvorschlag aus der Reichweite, offene Bestellungen
 * mit Wareneingang (Charge, Verfall), Bestand mit Zählung. Bestellliste zum Kopieren, bis ein Apotheken-Adapter angebunden ist.
 */
export default async function PharmacyPage() {
  const ctx = await getCtx()
  const { t, unit, locale } = ctx
  if (!ctx.hasModule('medication')) return <Forbidden text={t('common.moduleOff')} />
  if (!unit) return <main className="panel main" style={{ flex: 1 }}><div className="tabpanel"><Empty title={t('tasks.noUnit')} /></div></main>
  if (!ctx.canHere('resident.medication.stock')) return <Forbidden text={t('common.notAllowed')} />
  const now = new Date()
  const meds = await db.medication.findMany({
    where: { active: true, stock: { not: null }, resident: { orgId: ctx.org.id, unitId: unit.id, status: { in: ['active', 'absent'] } } },
    include: { resident: { select: { id: true, firstName: true, lastName: true, allergies: true, photoFileId: true, room: { select: { number: true } } } } },
    orderBy: [{ resident: { room: { number: 'asc' } } }, { name: 'asc' }],
  })
  const [orders, receipts] = await Promise.all([
    db.medicationStockEntry.findMany({ where: { orgId: ctx.org.id, unitId: unit.id, kind: 'order', status: 'open' }, orderBy: { at: 'asc' } }),
    db.medicationStockEntry.findMany({ where: { orgId: ctx.org.id, medicationId: { in: meds.map((m) => m.id) }, kind: 'receipt' }, orderBy: { at: 'desc' } }),
  ])
  const users = await db.user.findMany({ where: { orgId: ctx.org.id, id: { in: [...new Set(orders.map((o) => o.byId))] } }, select: { id: true, initials: true } })
  const who = (r: (typeof meds)[number]['resident']) => [r.room?.number, `${r.lastName} ${r.firstName}`].filter(Boolean).join(' ')
  const rctx = (r: (typeof meds)[number]['resident']) => ({ id: r.id, name: `${r.lastName} ${r.firstName}`, room: r.room?.number ?? null, allergies: r.allergies, photoId: r.photoFileId })
  const reach = (m: (typeof meds)[number]) => (m.kind === 'prn' ? t('meds.pharmacy.prn') : stockDays(m) != null ? t('meds.pharmacy.days', { n: stockDays(m)! }) : '–')
  const ordered = new Set(orders.map((o) => o.medicationId))
  const suggest: SuggestDto[] = meds.flatMap((m) => {
    if (ordered.has(m.id)) return []
    const q = reorderSuggestion({ kind: m.kind, stock: m.stock, daily: dailyUnits(m), prnMaxPerDay: m.prnMaxPerDay, endDate: m.endDate }, now)
    return q ? [{ medicationId: m.id, drug: m.name, resident: who(m.resident), stock: `${m.stock} ${m.stockUnit ?? ''}`.trim(), reach: reach(m), qty: q, unit: m.stockUnit ?? '' }] : []
  })
  const todayKey = dateKey(now)

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{t('meds.pharmacy.label', { unit: unit.name })}</span>
          <h1>{t('meds.pharmacy.title')}</h1>
          <p className="sub">{t('meds.pharmacy.sub')}</p>
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <section className="card" aria-labelledby="ph-sug">
            <div className="card-head"><h2 id="ph-sug">{t('meds.pharmacy.suggest')}</h2><span className="small muted">{t('meds.pharmacy.suggestHint', { days: REORDER_AT_DAYS, cover: COVER_DAYS })}</span></div>
            {suggest.length ? <SuggestTable rows={suggest} /> : <div className="card-body small muted">{t('meds.pharmacy.suggestNone')}</div>}
          </section>

          <section className="card" aria-labelledby="ph-open">
            <div className="card-head"><h2 id="ph-open">{t('meds.pharmacy.open')}</h2>{orders.length > 0 && <CopyOrderList />}</div>
            {orders.length ? (
              <ul className="list">
                {orders.map((o) => {
                  const m = meds.find((x) => x.id === o.medicationId)
                  if (!m) return null
                  return (
                    <li key={o.id} className="li th-row">
                      <span className="grow"><strong style={{ fontWeight: 500 }}>{m.name}</strong> · {who(m.resident)}<span className="small muted" style={{ display: 'block' }}><span className="mono">{o.quantity} {m.stockUnit ?? ''}</span> · {t('meds.pharmacy.orderedBy', { when: `${fmtDayMonth(o.at, locale)} ${hm(o.at)}`, by: users.find((u) => u.id === o.byId)?.initials ?? '?' })}</span></span>
                      <ReceiveButton medicationId={m.id} orderId={o.id} drug={m.name} qty={o.quantity} unit={m.stockUnit ?? ''} resident={rctx(m.resident)} todayKey={todayKey} />
                      <CancelOrder id={o.id} drug={m.name} />
                    </li>
                  )
                })}
              </ul>
            ) : <div className="card-body small muted">{t('meds.pharmacy.openNone')}</div>}
          </section>

          <section className="stack-sm" aria-labelledby="ph-stock">
            <h2 className="sec" id="ph-stock">{t('meds.pharmacy.stock')}</h2>
            {meds.length ? (
              <div className="tablewrap">
                <table className="stable">
                  <thead><tr><th>{t('meds.pharmacy.col.drug')}</th><th>{t('meds.pharmacy.col.resident')}</th><th className="right">{t('meds.pharmacy.col.stock')}</th><th>{t('meds.pharmacy.col.reach')}</th><th>{t('meds.pharmacy.col.lastReceipt')}</th><th className="right"><span className="sr-only">{t('meds.pharmacy.col.actions')}</span></th></tr></thead>
                  <tbody>
                    {meds.map((m) => {
                      const last = receipts.find((e) => e.medicationId === m.id)
                      const ex = expiryState(last?.expiry ?? null, now)
                      const days = stockDays(m)
                      return (
                        <tr key={m.id}>
                          <th scope="row" style={{ fontWeight: 500 }}>{m.name}{m.gtin && <div className="small muted mono">GTIN {m.gtin}</div>}</th>
                          <td>{who(m.resident)}</td>
                          <td className="right num nowrap">{m.stock} {m.stockUnit ?? ''}</td>
                          <td className="nowrap">{m.kind === 'prn' ? t('meds.pharmacy.prn') : days != null ? <span className={days < REORDER_AT_DAYS ? 'tag warn' : ''}>{t('meds.pharmacy.days', { n: days })}</span> : '–'}{ordered.has(m.id) && <> <span className="tag accent">{t('meds.pharmacy.col.ordered')}</span></>}</td>
                          <td className="small">{last ? <>{t('meds.pharmacy.batchLine', { batch: last.batch ?? '–', date: last.expiry ? fmtDate(last.expiry, locale) : '–' })}{ex === 'expired' && <> <span className="tag crit">{t('meds.pharmacy.expired')}</span></>}{ex === 'soon' && <> <span className="tag warn">{t('meds.pharmacy.expirySoon', { date: fmtDate(last.expiry!, locale) })}</span></>}</> : <span className="muted">–</span>}</td>
                          <td className="right nowrap"><div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                            {!ordered.has(m.id) && <ReceiveButton medicationId={m.id} drug={m.name} unit={m.stockUnit ?? ''} resident={rctx(m.resident)} todayKey={todayKey} />}
                            <CountButton medicationId={m.id} drug={m.name} stock={m.stock ?? 0} unit={m.stockUnit ?? ''} resident={rctx(m.resident)} />
                          </div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : <Empty title={t('meds.pharmacy.stockNone')} />}
          </section>
        </div>
      </div>
    </main>
  )
}
