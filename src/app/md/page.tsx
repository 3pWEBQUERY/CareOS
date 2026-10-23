import Link from 'next/link'
import { getMdCtx } from '@/lib/md/context'
import { patientBoard } from '@/lib/md/board'
import { openQuestions } from '@/lib/visit-data'
import { headers } from 'next/headers'
import { audit } from '@/lib/audit'
import { PatientList, PendingOrders, UpcomingVisits } from '@/components/md/Blocks'
import { Empty } from '@/components/ui/Empty'

export async function generateMetadata() {
  return { title: (await getMdCtx()).t('md.home.title') }
}

/** Ärzteportal – Meine Patient/innen: offene Fragen, auffällige Werte seit der letzten Visite, zu visieren, Termine. */
export default async function MdHome() {
  const md = await getMdCtx()
  const { t } = md
  const now = new Date()
  const [board, qs] = await Promise.all([patientBoard(md, md.residentIds, now), openQuestions(md, md.residentIds, now)])
  if (!(await headers()).get('next-router-prefetch')) await audit(md, { action: 'md.patients.view', entityType: 'Resident', context: { n: md.residentIds.length } })
  const nameOf = (id: string) => board.rows.find((r) => r.id === id)
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{t('md.portal')}</span>
          <h1>{t('md.home.title')}</h1>
          <p className="sub">{t('md.home.sub', { n: board.rows.length, org: md.org.name })}</p>
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          {!board.rows.length ? <Empty title={t('md.home.none')} /> : (
            <>
              <div className="metrics" aria-label={t('md.home.title')}>
                <a className="metric" href="#ph-q"><span className="lbl">{t('home.physician.metricQuestions')}</span><span className={'val' + (qs.length ? ' warn' : '')}>{qs.length}</span></a>
                <a className="metric" href="#ph-confirm"><span className="lbl">{t('home.physician.metricConfirm')}</span><span className={'val' + (board.pending.some((p) => p.state === 'overdue') ? ' crit' : board.pending.length ? ' warn' : '')}>{board.pending.length}</span></a>
                <a className="metric" href="#ph-visits"><span className="lbl">{t('home.physician.metricVisits')}</span><span className="val">{board.appointments.filter((a) => a.today).length}</span></a>
              </div>
              <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
                <div className="stack">
                  <PatientList t={t} rows={board.rows} hrefOf={(id) => `/md/p/${id}`} title={t('md.home.title')} />
                </div>
                <div className="stack">
                  <section className="card" aria-labelledby="ph-q">
                    <div className="card-head"><h2 id="ph-q">{t('home.physician.questions')}</h2></div>
                    {qs.length ? (
                      <ul className="list">
                        {qs.slice(0, 12).map((q) => {
                          const r = nameOf(q.residentId)
                          return (
                            <li key={q.dto.id}>
                              <Link className="li" href={`/md/p/${q.residentId}#visit`}>
                                <span className="grow">
                                  <span style={{ display: 'block' }}>{q.dto.text}</span>
                                  <span className="small muted">{[r?.room, r?.name].filter(Boolean).join(' ')} · {t('visit.overview.askedBy', { by: q.dto.by, when: q.dto.when })}</span>
                                </span>
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    ) : <div className="card-body small muted">{t('home.physician.questionsNone')}</div>}
                  </section>
                  <PendingOrders t={t} items={board.pending} hrefOf={(rid) => `/md/p/${rid}#orders`} />
                  <UpcomingVisits t={t} items={board.appointments} hrefOf={(rid) => `/md/p/${rid}#visit`} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
