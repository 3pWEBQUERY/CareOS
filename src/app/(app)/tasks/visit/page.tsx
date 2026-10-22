import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { age, dateKey, fmtDate, fmtDayMonth, fmtNum, fmtRel, hm, startOfDay } from '@/lib/time'
import { VITALS } from '@/lib/vitals'
import { taskView } from '@/lib/tasks'
import { openQuestions, visitChanges, visitRoster, visitsToday } from '@/lib/visit-data'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { GuardedLink, VisitList } from '@/components/visit/VisitList'
import { VisitCapture } from '@/components/visit/VisitCapture'
import type { VisitNavDto } from '@/components/visit/types'
import { Spark } from '@/app/(app)/residents/_components/Spark'
import { OBS_TONE } from '@/app/(app)/residents/_lib/resident'

export async function generateMetadata() {
  return { title: (await getCtx()).t('visit.title') }
}

/**
 * Arztvisite (PRD §29): eigenständige Arbeitsansicht für Tablet und Desktop. Links die Personen der Visite,
 * in der Mitte Banner und Veränderungen seit der letzten Visite, rechts die Erfassung (Antworten, Anordnungen).
 * Ohne gewählte Person: Vorbereitung mit allen vorgemerkten Fragen und Terminen des Bereichs.
 */
export default async function VisitPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, unit } = ctx
  if (!unit) return <main className="panel main" style={{ flex: 1 }}><div className="tabpanel"><Empty title={t('tasks.noUnit')} /></div></main>
  if (!ctx.canHere('resident.read')) return <Forbidden text={t('common.notAllowed')} />
  const now = new Date()
  const day = startOfDay(now)

  const picked = sp.r ? await residentInScope(ctx, sp.r) : null
  const r = picked && picked.unitId === unit.id ? picked : null
  const { rows, residents, appointments } = await visitRoster(ctx, unit.id, r?.id ?? null, now)
  const label = (row: (typeof rows)[number]) => [row.room, row.name].filter(Boolean).join(' ')
  const idx = r ? rows.findIndex((x) => x.id === r.id) : -1
  const nextOpen = (from: number) => {
    for (let k = 1; k <= rows.length; k++) {
      const x = rows[(from + k + rows.length) % rows.length]
      if (x && !x.done && x.id !== r?.id) return { href: x.href, label: label(x) }
    }
    return null
  }
  const nav: VisitNavDto = {
    prev: idx > 0 ? rows[idx - 1].href : null,
    next: idx >= 0 ? (idx < rows.length - 1 ? { href: rows[idx + 1].href, label: label(rows[idx + 1]) } : null) : rows[0] ? { href: rows[0].href, label: label(rows[0]) } : null,
  }
  const firstOpen = rows.find((x) => !x.done) ?? rows[0] ?? null
  const titles = [...new Set(appointments.map((a) => a.title))]

  return (
    <main className="panel main visit-main">
      <div className="view-head">
        <div>
          <span className="lbl">{t('visit.label')} · {unit.name} · {fmtDayMonth(day)}</span>
          <h1>{t('visit.title')}</h1>
          {titles.length > 0 && <p className="sub">{titles.join(', ')}</p>}
        </div>
        <div className="row head-actions">
          {!r && firstOpen && <Link className="btn primary" href={firstOpen.href}>{t('visit.start')}</Link>}
          <GuardedLink className="btn" href="/tasks">{t('visit.exit')}</GuardedLink>
        </div>
      </div>
      <div className="visit" data-mode={r ? 'person' : 'overview'}>
        <VisitList rows={rows} currentId={r?.id ?? null} residents={residents} nav={nav} />
        {r ? <Person ctx={ctx} r={r} now={now} next={nextOpen(idx)} /> : <Overview ctx={ctx} rows={rows} appointments={appointments} now={now} />}
      </div>
    </main>
  )
}

type Ctx = Awaited<ReturnType<typeof getCtx>>

async function Overview({ ctx, rows, appointments, now }: { ctx: Ctx; rows: Awaited<ReturnType<typeof visitRoster>>['rows']; appointments: Awaited<ReturnType<typeof visitRoster>>['appointments']; now: Date }) {
  const { t } = ctx
  const qs = await openQuestions(ctx, rows.map((x) => x.id), now)
  const byRes = rows.map((row) => ({ row, qs: qs.filter((q) => q.residentId === row.id).map((q) => q.dto) })).filter((x) => x.qs.length)
  return (
    <div className="visit-center visit-overview">
      <section className="card" aria-labelledby="vo-appts">
        <div className="card-head"><h2 id="vo-appts">{t('visit.overview.appointments')}</h2></div>
        {appointments.length ? (
          <ul className="list">
            {appointments.map((a) => {
              const row = rows.find((x) => x.id === a.residentId)
              return (
                <li key={a.id}>
                  <Link className="li" href={`/tasks/visit?r=${a.residentId}`}>
                    <time className="mono small nowrap" style={{ minWidth: 48 }}>{hm(a.at)}</time>
                    <span className="grow"><span>{row ? [row.room, row.name].filter(Boolean).join(' ') : '–'}</span><span className="small muted"> · {a.title}</span></span>
                    {a.done || row?.done ? <span className="tag ok"><span aria-hidden="true">✓ </span>{t('visit.list.done')}</span> : <span className="tag outline">{t('visit.list.open')}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : <div className="card-body small muted">{t('visit.overview.noAppointments')}</div>}
      </section>
      <section className="stack-sm" aria-labelledby="vo-q">
        <h2 className="sec" id="vo-q">{t('visit.overview.title')}</h2>
        {byRes.length ? byRes.map(({ row, qs }) => (
          <section key={row.id} className="card" aria-labelledby={'vq-' + row.id}>
            <div className="card-head">
              <h3 id={'vq-' + row.id}><Link className="linkbtn" href={row.href}>{[row.room, row.name].filter(Boolean).join(' ')}</Link></h3>
              <span className="small muted">{t('visit.list.questions', { n: qs.length })}</span>
            </div>
            <ul className="list">
              {qs.map((q) => (
                <li key={q.id} className="li">
                  <span className="grow">
                    <span style={{ display: 'block' }}>{q.text}</span>
                    <span className="small muted">{q.ref && <><Link className="linkbtn small" href={q.ref.href}>{q.ref.label}</Link> · </>}{t('visit.overview.askedBy', { by: q.by, when: q.when })}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )) : <Empty title={t('visit.overview.empty')} />}
      </section>
    </div>
  )
}

async function Person({ ctx, r, now, next }: { ctx: Ctx; r: NonNullable<Awaited<ReturnType<typeof residentInScope>>>; now: Date; next: { href: string; label: string } | null }) {
  const { t, locale } = ctx
  const scope = { unitId: r.unitId, locationId: r.unit.locationId }
  const canMeds = ctx.can('resident.medication.read', scope)
  const canConduct = ctx.can('resident.visit.conduct', scope)
  const [changes, qs, done, appts] = await Promise.all([
    visitChanges(ctx, r.id, canMeds, now),
    openQuestions(ctx, [r.id], now),
    visitsToday(ctx, r.id, now),
    db.appointment.findMany({ where: { residentId: r.id, kind: 'physician', at: { gte: startOfDay(now), lt: new Date(startOfDay(now).getTime() + 86_400_000) } }, orderBy: { at: 'asc' } }),
  ])
  const appt = appts.find((a) => !a.done) ?? appts[0] ?? null
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)
  const reaCls = r.rea === 'yes' ? 'rea-yes' : r.rea === 'no' ? 'rea-no' : ''
  const reaText = t(r.rea === 'yes' ? 'residents.banner.reaYes' : r.rea === 'no' ? 'residents.banner.reaNo' : 'residents.banner.reaUnknown')
  const name = `${r.lastName} ${r.firstName}`
  const who = `${name} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`
  const val = (k: keyof typeof VITALS, v: number) => `${fmtNum(v, VITALS[k].dec, locale)} ${VITALS[k].unit}`
  const sinceText = changes.fromVisit ? t('visit.person.since', { date: fmtDate(changes.since, locale) }) : t('visit.person.sinceDefault')
  const physician = r.physician ?? ''

  return (
    <>
      <div className="visit-center visit-person">
        <section className="visit-banner" aria-labelledby="vp-h">
          <div className="visit-banner-who">
            <span className="room mono" aria-label={`${t('residents.banner.room')} ${r.room?.number ?? '–'}`}>{r.room?.number ?? '–'}</span>
            <div className="grow">
              <h2 id="vp-h" tabIndex={-1}>{r.lastName} <span>{r.firstName}</span></h2>
              <p className="small muted" style={{ margin: 0 }}>
                <span className="mono">{age(r.birthDate)} {t('common.years')}</span>
                {appt && <> · {t('visit.person.appointment')} <span className="mono">{hm(appt.at)}</span></>}
                {appt ? <> · {appt.title}</> : physician && <> · {physician}</>}
              </p>
            </div>
            <GuardedLink className="btn sm" href={`/residents/${r.id}`}>{t('visit.person.toChart')}</GuardedLink>
          </div>
          <div className="flags">
            {r.status === 'absent' && <span className="flag info">{t('residents.banner.absent')}</span>}
            {r.allergies.length ? r.allergies.map((a) => <span key={a} className="flag crit">{t('residents.banner.allergy', { name: a })}</span>) : <span className="flag">{t('residents.banner.noAllergies')}</span>}
            {r.risks.map((a) => <span key={a} className="flag warn">{a}</span>)}
            <span className={'flag ' + reaCls}>{reaText}</span>
          </div>
          {r.importantNotes && <p className="small rec-note" style={{ margin: 0 }}><span className="lbl">{t('residents.rec.important')}</span> {r.importantNotes}</p>}
        </section>

        {done.map((v) => (
          <section key={v.id} className="card ok" aria-labelledby={'vd-' + v.id}>
            <div className="card-head">
              <h3 id={'vd-' + v.id}><span aria-hidden="true">✓ </span>{t('visit.person.done', { time: hm(v.at) })}</h3>
              <span className="small muted">{t('visit.person.doneBy', { by: v.by })}</span>
            </div>
            {v.questions.length > 0 && (
              <ul className="list">
                {v.questions.map((q) => (
                  <li key={q.id} className="li">
                    <span className="grow small"><span className="fg2">{q.text}</span><span style={{ display: 'block', fontWeight: 500 }}><span aria-hidden="true">→ </span>{q.answer}</span></span>
                  </li>
                ))}
              </ul>
            )}
            {v.orders.length > 0 && (
              <ul className="list visit-done-orders">
                {v.orders.map((o) => {
                  const view = o.task ? taskView(o.task, now) : null
                  return (
                    <li key={o.id} className="li">
                      <span className={'tag ' + (o.kind === 'medication' ? 'violet' : 'accent')} style={{ flex: 'none' }}>{t('visit.kinds.' + o.kind)}</span>
                      <span className="grow small">{o.text}{o.dueAt && <span className="muted mono"> · {fmtDayMonth(o.dueAt)} {hm(o.dueAt)}</span>}</span>
                      {view && <span className={'tag ' + (view === 'done' ? 'ok' : view === 'over' ? 'crit' : 'outline')}>{t('tasks.view.' + view)}</span>}
                      {o.kind === 'medication' && canMeds && <Link className="linkbtn small nowrap" href={`/residents/${r.id}/meds#orders`}>{t('visit.task.toMeds')} →</Link>}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}

        <p className="lbl" style={{ margin: 0 }}>{sinceText}</p>

        <section className="card" aria-labelledby="vp-vit">
          <div className="card-head"><h3 id="vp-vit">{t('visit.person.vitals')}</h3><Link className="linkbtn small" href={`/residents/${r.id}/vitals`}>{t('residents.tabs.vitals')} →</Link></div>
          {changes.vitals.length ? (
            <ul className="list">
              {changes.vitals.map((c) => {
                const arrow = c.lastFlag === 'hi' ? '▲' : c.lastFlag === 'lo' ? '▼' : ''
                const labelText = t('common.vitals.' + c.key)
                return (
                  <li key={c.key} className="li visit-vital">
                    <span className="grow">
                      <span className="visit-vital-name">{labelText}</span>
                      <span className="small muted" style={{ display: 'block' }}>
                        {c.key === 'weight'
                          ? t('visit.person.weightDelta', { delta: `${c.series[c.series.length - 1] - c.series[0] > 0 ? '+' : ''}${fmtNum(c.series[c.series.length - 1] - c.series[0], 1, locale)}` })
                          : <>{t('visit.person.measured', { abnormal: c.abnormal, n: c.count })}{c.peak !== c.last && <> · {t('visit.person.peak', { value: val(c.key, c.peak) })}</>}</>}
                      </span>
                    </span>
                    <Spark values={c.series} label={labelText} />
                    <span className="visit-vital-val">
                      <span className="small muted">{t('visit.person.last')} · {rel(c.lastAt)}</span>
                      <span className={'mono' + (c.lastFlag ? ' crit-text' : '')}>{val(c.key, c.last)}{arrow && <> <span aria-hidden="true">{arrow}</span></>}</span>
                      <span className="small">{c.key === 'weight' ? '' : t(c.lastFlag ? 'visit.person.' + c.lastFlag : 'visit.person.normal')}{c.trend && <> · {t('visit.person.trend.' + c.trend)}</>}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : <div className="card-body small muted">{t('visit.person.noVitals')}</div>}
        </section>

        <section className="card" aria-labelledby="vp-notes">
          <div className="card-head"><h3 id="vp-notes">{t('visit.person.notes')}</h3><Link className="linkbtn small" href={`/residents/${r.id}/notes`}>{t('residents.tabs.notes')} →</Link></div>
          {changes.notes.length ? (
            <ul className="list">
              {changes.notes.map((o) => (
                <li key={o.id} className="li visit-note">
                  <time className="small muted mono nowrap">{rel(o.at)}</time>
                  <span className={'tag ' + (o.category === 'incident' ? 'crit' : o.important ? 'warn' : OBS_TONE[o.category] ?? '')} style={{ flex: 'none' }}>{t('chart.cat.' + o.category)}</span>
                  <span className="grow small fg2 visit-note-text">{o.text}</span>
                </li>
              ))}
            </ul>
          ) : <div className="card-body small muted">{t('visit.person.noNotes')}</div>}
        </section>

        {canMeds && (
          <section className="card" aria-labelledby="vp-meds">
            <div className="card-head"><h3 id="vp-meds">{t('visit.person.meds')}</h3><Link className="linkbtn small" href={`/residents/${r.id}/meds`}>{t('residents.tabs.meds')} →</Link></div>
            {changes.meds.length || changes.missed.length ? (
              <ul className="list">
                {changes.meds.map((m) => <li key={m.key} className="li"><time className="small muted mono nowrap">{fmtDayMonth(m.at)}</time><span className="grow small">{m.text}</span></li>)}
                {changes.missed.map((m) => <li key={m.key} className="li"><span className="tag warn" style={{ flex: 'none' }}>{t('chart.timeline.kinds.medication')}</span><span className="grow small">{m.text}</span></li>)}
              </ul>
            ) : <div className="card-body small muted">{t('visit.person.noMeds')}</div>}
          </section>
        )}
      </div>
      <VisitCapture
        key={r.id + ':' + done.length}
        residentId={r.id}
        name={name}
        who={who}
        physician={physician}
        appointmentId={appt && !appt.done ? appt.id : null}
        questions={qs.map((q) => q.dto)}
        readOnly={!canConduct}
        documented={done.length > 0}
        next={next}
        todayKey={dateKey(now)}
      />
    </>
  )
}
