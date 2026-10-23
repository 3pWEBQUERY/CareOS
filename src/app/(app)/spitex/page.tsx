import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCtx } from '@/lib/context'
import { addDays, dateKey, fmtDate, hm, parseDateKey, startOfDay } from '@/lib/time'
import { PLAN_AHEAD_DAYS, addressLine, isClosedVisit, isLiveVisit, type Conflict } from '@/lib/spitex'
import { dayBoard, pickUnit, spitexUnits, type VisitRow } from '@/lib/spitex-data'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { SpitexHead, UnitSeg } from './_ui/SpitexHead'
import { AssignSelect, MoveButtons, VisitButton, type Opt, type VisitDto } from './_ui/DispatchClient'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('nav.spitex') + ' · ' + t('spitex.tabs.dispatch') }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Disposition (PRD §60 Spitex): Tagesplan eines Einsatzgebiets – offene Einsätze, Touren je Person in Reihenfolge,
 * Zuweisen und Umordnen, Einsätze planen und ändern, Hinweise bei Überschneidung, Abwesenheit oder Stationsdienst.
 * Ohne Dispositionsrecht nur lesend; Personen ohne Leserecht, aber mit eigener Tour, landen in «Meine Tour».
 */
export default async function SpitexPage({ searchParams }: { searchParams: Promise<{ u?: string; d?: string }> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.hasModule('spitex')) return <Forbidden text={t('common.moduleOff')} />
  const { units, unit } = pickUnit(ctx, sp.u)
  const canPlanAny = spitexUnits(ctx, 'spitex.plan').length > 0
  const tourUnits = spitexUnits(ctx, 'spitex.document')
  if (tourUnits.length && (!unit || (!canPlanAny && !sp.u && !sp.d))) redirect('/spitex/tour')
  if (!unit) return <NoArea ctx={ctx} />

  const today = startOfDay()
  const day = sp.d && DAY_RE.test(sp.d) ? parseDateKey(sp.d) : today
  const b = await dayBoard(ctx, unit, day)
  const canPlan = ctx.can('spitex.plan', { unitId: unit.id, locationId: unit.locationId })
  const editable = canPlan && day >= today
  const dayKey = dateKey(day)
  const link = (d: Date) => `/spitex?u=${unit.id}&d=${dateKey(d)}`
  const name = (id: string) => { const r = b.rOf(id); return r ? `${r.lastName} ${r.firstName}` : '–' }
  const clients: Opt[] = b.residents.filter((r) => r.status === 'active' && r.unitId === unit.id).map((r) => ({ id: r.id, label: `${r.lastName} ${r.firstName}`, hint: addressLine(r) || undefined }))
  const staff: Opt[] = b.staff.map((s) => ({ id: s.id, label: `${s.lastName} ${s.firstName}`, hint: s.jobTitle ?? undefined }))
  const staffName = (id: string) => { const s = b.staff.find((x) => x.id === id); return s ? `${s.firstName.charAt(0)}. ${s.lastName}` : '–' }
  const live = b.visits.filter((v) => isLiveVisit(v.status))
  const conflictText = (c: Conflict) => {
    if (c.kind === 'overlap') { const o = b.visits.find((x) => x.id === c.with); return t('spitex.conflict.overlap', { name: o ? name(o.residentId) : '–', time: o ? `${hm(o.plannedStart)}–${hm(o.plannedEnd)}` : '–' }) }
    return t('spitex.conflict.' + c.kind, { label: c.label })
  }
  const dto = (v: VisitRow): VisitDto => ({
    id: v.id, residentId: v.residentId, date: dayKey, start: hm(v.plannedStart), end: hm(v.plannedEnd), assigneeId: v.assigneeId, note: v.note,
    fromTemplate: !!v.templateId, services: v.services.map((s) => ({ klv: s.klv, label: s.label, minutes: s.plannedMin })),
  })
  const common = { clients, staff, day: dayKey, today: dateKey(today), maxDay: dateKey(addDays(today, PLAN_AHEAD_DAYS)) }

  const item = (v: VisitRow, i: number, list: VisitRow[]) => {
    const r = b.rOf(v.residentId)
    const conflicts = b.conflicts.get(v.id) ?? []
    const mins = v.services.reduce((s, x) => s + x.plannedMin, 0)
    const n = name(v.residentId)
    const planned = v.status === 'planned' && editable
    return (
      <li key={v.id} className={'sx-visit' + (v.status === 'cancelled' || v.status === 'missed' ? ' is-off' : '') + (conflicts.length ? ' has-conflict' : '')}>
        <div className="sx-visit-main">
          <time className="mono sx-time">{hm(v.plannedStart)}<span className="muted">–{hm(v.plannedEnd)}</span></time>
          <div className="grow">
            <div className="sx-visit-name">
              <Link className="linkbtn" href={`/residents/${v.residentId}`}>{n}</Link>
              {v.status !== 'planned' && <span className={'tag ' + STATUS_TONE[v.status]}>{t('spitex.status.' + v.status)}</span>}
              {r?.status === 'absent' && <span className="tag warn">{t('spitex.clientAbsent')}</span>}
            </div>
            <div className="small muted sx-addr">{(r && addressLine(r)) || t('spitex.noAddress')}</div>
            <div className="sx-klv small">
              {v.services.map((s) => <span key={s.id} className="sx-chip"><b>{s.klv}</b> {s.label} <span className="mono muted">{s.plannedMin}′</span></span>)}
              <span className="mono muted">{t('spitex.minutes', { n: mins })}</span>
            </div>
            {v.status === 'done' && v.actualStart && v.actualEnd && <div className="small ok-text">{t('spitex.doneAt', { from: hm(v.actualStart), to: hm(v.actualEnd) })}</div>}
            {conflicts.map((c, k) => <div key={k} className="sx-conflict small" role="note"><span aria-hidden="true">! </span>{conflictText(c)}</div>)}
          </div>
        </div>
        {planned && (
          <div className="sx-visit-tools">
            <AssignSelect visitId={v.id} value={v.assigneeId} staff={staff} name={n} />
            {v.assigneeId && <MoveButtons visitId={v.id} first={i === 0} last={i === list.length - 1} name={n} />}
            <VisitButton {...common} visit={dto(v)} className="btn sm" />
          </div>
        )}
      </li>
    )
  }

  return (
    <main className="panel main sx" style={{ flex: 1 }}>
      <SpitexHead ctx={ctx} current="dispatch" title={t('spitex.dispatch.title')} where={unit.name} unitId={unit.id}
        actions={<>
          <UnitSeg ctx={ctx} units={units} current={unit.id} base="/spitex" extra={'&d=' + dayKey} />
          {editable && <VisitButton {...common} />}
        </>} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="row-between sx-daybar">
            <nav className="seg" aria-label={t('spitex.dispatch.day')}>
              <Link href={link(addDays(day, -1))} aria-label={t('spitex.dispatch.prev')}>‹</Link>
              <Link href={link(today)} aria-current={dayKey === dateKey(today) ? 'page' : undefined}>{t('common.today')}</Link>
              <Link href={link(addDays(day, 1))} aria-label={t('spitex.dispatch.next')}>›</Link>
            </nav>
            <strong className="sx-dayname">{fmtDate(day, locale, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
          </div>

          <div className="metrics" role="group" aria-label={t('spitex.dispatch.summary')}>
            <div className="metric"><span className="lbl">{t('spitex.dispatch.visits')}</span><span className="val">{live.length}</span></div>
            <div className="metric"><span className="lbl">{t('spitex.dispatch.open')}</span><span className={'val' + (b.open.filter((v) => !isClosedVisit(v.status)).length ? ' warn' : '')}>{b.open.filter((v) => !isClosedVisit(v.status)).length}</span></div>
            <div className="metric"><span className="lbl">{t('spitex.dispatch.conflicts')}</span><span className={'val' + (b.conflicts.size ? ' warn' : '')}>{b.conflicts.size}</span></div>
            <div className="metric"><span className="lbl">{t('spitex.dispatch.done')}</span><span className="val">{b.visits.filter((v) => v.status === 'done').length}<small>/{live.length}</small></span></div>
          </div>

          {!b.visits.length && !clients.length ? (
            <Empty title={t('spitex.dispatch.noClients')}>{canPlan ? t('spitex.dispatch.noClientsHint') : null}</Empty>
          ) : (
            <div className="sx-board">
              <section className="card sx-col sx-open" aria-labelledby="sx-open-h">
                <div className="card-head"><h2 id="sx-open-h">{t('spitex.dispatch.openTitle')}</h2><span className="pill">{b.open.length}</span></div>
                {b.open.length ? <ul className="list">{b.open.map(item)}</ul> : <div className="card-body small muted">{t('spitex.dispatch.openNone')}</div>}
              </section>
              {b.tours.map(({ user, visits, busy }) => {
                const tour = visits.filter((v) => isLiveVisit(v.status))
                return (
                  <section key={user.id} className="card sx-col" aria-labelledby={'sx-t-' + user.id}>
                    <div className="card-head">
                      <h2 id={'sx-t-' + user.id}>{`${user.lastName} ${user.firstName}`}</h2>
                      <span className="small muted mono">{tour.length ? `${hm(tour[0].plannedStart)}–${hm(tour.reduce((m, v) => (v.plannedEnd > m ? v.plannedEnd : m), tour[0].plannedEnd))} · ${t('spitex.visitsN', { n: tour.length })}` : t('spitex.visitsN', { n: 0 })}</span>
                    </div>
                    {busy.length > 0 && <div className="sx-busy small">{busy.map((x, k) => <span key={k} className="tag warn">{t('spitex.busy.' + x.kind, { label: x.label })}</span>)}</div>}
                    {visits.length ? <ul className="list">{visits.map(item)}</ul> : <div className="card-body small muted">{t('spitex.dispatch.tourNone', { name: staffName(user.id) })}</div>}
                    {editable && <div className="card-foot"><VisitButton {...common} assigneeId={user.id} className="btn sm ghost" label={t('spitex.actions.addToTour')} /></div>}
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

const STATUS_TONE: Record<string, string> = { started: 'accent', done: 'ok', missed: 'crit', cancelled: 'outline', planned: '' }

/** Kein Einsatzgebiet: Hinweis, wo es eingerichtet wird. */
function NoArea({ ctx }: { ctx: Awaited<ReturnType<typeof getCtx>> }) {
  const { t } = ctx
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head"><div><span className="lbl">{t('nav.spitex')}</span><h1>{t('spitex.dispatch.title')}</h1></div></div>
      <div className="tabpanel">
        <Empty title={t('spitex.noArea')} action={ctx.can('admin.org') ? <Link className="btn" href="/admin/structure">{t('spitex.noAreaAdmin')}</Link> : undefined}>
          {t(ctx.can('admin.org') ? 'spitex.noAreaHintAdmin' : 'spitex.noAreaHint')}
        </Empty>
      </div>
    </main>
  )
}
