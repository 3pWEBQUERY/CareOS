import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { dateKey, fmtDbDate, fromDbDate, startOfDay } from '@/lib/time'
import { WEEK_ORDER } from '@/lib/recurrence'
import { addressLine, parseServices } from '@/lib/spitex'
import { pickUnit, spitexStaff } from '@/lib/spitex-data'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { SpitexHead, UnitSeg } from '../_ui/SpitexHead'
import { ClientButton, EndTemplateButton, TemplateButton, type TemplateDto } from './ClientsClient'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('nav.spitex') + ' · ' + t('spitex.tabs.clients') }
}

/**
 * Klient/innen eines Einsatzgebiets: Einsatzort, Telefon, ob ein Zugang hinterlegt ist (Inhalt nur in der Tour bzw.
 * auf Abruf mit Protokoll) und die Wochenvorlagen, aus denen die Einsätze je Tag entstehen.
 */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.hasModule('spitex')) return <Forbidden text={t('common.moduleOff')} />
  const { units, unit } = pickUnit(ctx, sp.u)
  if (!unit) return <Forbidden text={t('common.notAllowed')} />
  const canPlan = ctx.can('spitex.plan', { unitId: unit.id, locationId: unit.locationId })
  const residents = await db.resident.findMany({
    where: { orgId: ctx.org.id, unitId: unit.id, status: { in: ['active', 'absent'] } },
    select: { id: true, firstName: true, lastName: true, status: true, street: true, postalCode: true, city: true, phone: true, accessNote: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  const [templates, staff] = await Promise.all([
    db.homeCareTemplate.findMany({ where: { orgId: ctx.org.id, residentId: { in: residents.map((r) => r.id) }, active: true }, orderBy: [{ start: 'asc' }] }),
    spitexStaff(ctx.org.id, unit),
  ])
  const staffOpts = staff.map((s) => ({ id: s.id, label: `${s.lastName} ${s.firstName}` }))
  const staffName = (id: string | null) => { const s = staff.find((x) => x.id === id); return s ? `${s.firstName.charAt(0)}. ${s.lastName}` : null }
  const days = t('common.weekdaysShort').split(',')
  const dayList = (w: number[]) => (w.length === 7 ? t('spitex.templates.daily') : WEEK_ORDER.filter((d) => w.includes(d)).map((d) => days[d]).join(', '))
  const today = dateKey(startOfDay())
  const dto = (x: (typeof templates)[number]): TemplateDto => ({
    id: x.id, weekdays: x.weekdays, start: x.start, end: x.end, preferredUserId: x.preferredUserId, note: x.note,
    startDate: dateKey(fromDbDate(x.startDate)), endDate: x.endDate ? dateKey(fromDbDate(x.endDate)) : null,
    services: parseServices(x.services),
  })
  const withAddress = residents.filter((r) => addressLine(r)).length

  return (
    <main className="panel main sx" style={{ flex: 1 }}>
      <SpitexHead ctx={ctx} current="clients" title={t('spitex.clients.title')} where={unit.name} unitId={unit.id}
        actions={<UnitSeg ctx={ctx} units={units} current={unit.id} base="/spitex/clients" />} />
      <div className="scroll">
        <div className="tabpanel">
          {residents.length > 0 && withAddress < residents.length && (
            <div className="alert warn"><span className="grow">{t('spitex.clients.missingAddress', { n: residents.length - withAddress })}</span></div>
          )}
          {residents.length ? (
            <ul className="sx-clients">
              {residents.map((r) => {
                const name = `${r.lastName} ${r.firstName}`
                const own = templates.filter((x) => x.residentId === r.id)
                return (
                  <li key={r.id} className="card">
                    <div className="card-head">
                      <h2><Link className="linkbtn" href={`/residents/${r.id}`}>{name}</Link>{r.status === 'absent' && <> <span className="tag warn">{t('spitex.clientAbsent')}</span></>}</h2>
                      {canPlan && <ClientButton c={{ id: r.id, name, street: r.street, postalCode: r.postalCode, city: r.city, phone: r.phone, hasAccess: !!r.accessNote }} />}
                    </div>
                    <div className="card-body stack-sm">
                      <dl className="kv">
                        <dt>{t('spitex.clients.address')}</dt><dd>{addressLine(r) || <span className="muted">{t('spitex.noAddress')}</span>}</dd>
                        <dt>{t('spitex.clients.phone')}</dt><dd className="mono">{r.phone || <span className="muted">–</span>}</dd>
                        <dt>{t('spitex.access.title')}</dt><dd>{r.accessNote ? t('spitex.access.stored') : <span className="muted">{t('spitex.access.noneShort')}</span>}</dd>
                      </dl>
                      <div className="sec-head"><h3 className="sub">{t('spitex.templates.title')}</h3>{canPlan && <TemplateButton clientId={r.id} clientName={name} staff={staffOpts} today={today} />}</div>
                      {own.length ? (
                        <ul className="list sx-tpl-list">
                          {own.map((x) => {
                            const svc = parseServices(x.services)
                            const label = `${dayList(x.weekdays)} ${x.start}–${x.end}`
                            return (
                              <li key={x.id} className="li sx-tpl">
                                <div className="grow">
                                  <div><span className="mono">{x.start}–{x.end}</span> · {dayList(x.weekdays)}</div>
                                  <div className="small fg2">{svc.map((s) => `${s.label} (${s.klv}, ${s.minutes}′)`).join(' · ')}</div>
                                  <div className="small muted">
                                    {[staffName(x.preferredUserId) && t('spitex.templates.preferredShort', { name: staffName(x.preferredUserId)! }), t('spitex.templates.validFrom', { date: fmtDbDate(x.startDate, locale) }), x.endDate && t('spitex.templates.validUntil', { date: fmtDbDate(x.endDate, locale) })].filter(Boolean).join(' · ')}
                                  </div>
                                </div>
                                {canPlan && (
                                  <div className="row" style={{ gap: 6 }}>
                                    <TemplateButton clientId={r.id} clientName={name} staff={staffOpts} today={today} tpl={dto(x)} />
                                    <EndTemplateButton id={x.id} label={label} />
                                  </div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      ) : <p className="small muted" style={{ margin: 0 }}>{t('spitex.templates.none')}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : <Empty title={t('spitex.clients.none')}>{t('spitex.clients.noneHint')}</Empty>}
        </div>
      </div>
    </main>
  )
}
