import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, startOfDay } from '@/lib/time'
import type { HomeView } from '@/lib/home-view'
import { myPatientIds, patientBoard } from '@/lib/md/board'
import { openQuestions } from '@/lib/visit-data'
import { HomeHead } from './Head'
import { ForYou } from './ForYou'
import { PatientList, PendingOrders, UpcomingVisits } from '@/components/md/Blocks'

/**
 * Ärztliche Startseite (PRD §4.6, §7): meine Patient/innen, offene Fragen für die Visite, unbestätigte telefonische
 * Verordnungen und anstehende Visiten – statt der Pflegeansicht mit Zuteilung und Übergabe.
 * «Meine» = aktive Zuordnung (ResidentPhysician); ohne Zuordnung die Personen des Bereichs mit Visitenbedarf.
 */
export async function PhysicianHome({ ctx, now, greet, view, views }: { ctx: Ctx; now: Date; greet: string; view: HomeView; views: HomeView[] }) {
  const { t } = ctx
  const assigned = await myPatientIds(ctx.org.id, ctx.user.id, ctx.unitIds, now)
  let ids = assigned
  if (!assigned.length && ctx.unit) {
    // Ohne Zuordnung: Bereich mit offenen Fragen, Arztterminen (7 Tage) oder zu visierenden Verordnungen
    const day = startOfDay(now)
    const rs = await db.resident.findMany({
      where: {
        orgId: ctx.org.id, unitId: ctx.unit.id, status: { in: ['active', 'absent'] },
        OR: [
          { visitQuestions: { some: { status: 'open' } } },
          { appointments: { some: { kind: 'physician', done: false, at: { gte: day, lt: addDays(day, 8) } } } },
          { medications: { some: { orderSource: { in: ['phone', 'verbal'] }, confirmedAt: null } } },
        ],
      },
      select: { id: true },
    })
    ids = rs.map((r) => r.id)
  }
  const [board, qs] = await Promise.all([patientBoard(ctx, ids, now), openQuestions(ctx, ids, now)])
  const canMeds = ctx.can('resident.medication.read')
  const where = assigned.length ? t('home.physician.allUnits') : ctx.unit?.name ?? ''
  const todayVisits = board.appointments.filter((a) => a.today).length
  const nameOf = (id: string) => board.rows.find((r) => r.id === id)

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <HomeHead t={t} view={view} views={views} greet={greet} label={ctx.org.name} sub={t('home.physician.sub', { where })}
        actions={ctx.can('resident.read') ? <Link className="btn primary" href="/tasks/visit">{t('home.physician.startVisit')}</Link> : undefined} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics" aria-label={t('home.view.physician')}>
            <a className="metric" href="#ph-patients"><span className="lbl">{t('home.physician.metricPatients')}</span><span className="val">{board.rows.length}</span></a>
            <a className="metric" href="#ph-q"><span className="lbl">{t('home.physician.metricQuestions')}</span><span className={'val' + (qs.length ? ' warn' : '')}>{qs.length}</span></a>
            <a className="metric" href="#ph-confirm"><span className="lbl">{t('home.physician.metricConfirm')}</span><span className={'val' + (board.pending.some((p) => p.state === 'overdue') ? ' crit' : board.pending.length ? ' warn' : '')}>{board.pending.length}</span></a>
            <a className="metric" href="#ph-visits"><span className="lbl">{t('home.physician.metricVisits')}</span><span className="val">{todayVisits}</span></a>
          </div>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
            <div className="stack">
              <PatientList t={t} rows={board.rows} hrefOf={(id) => `/tasks/visit?r=${id}`} title={t(assigned.length ? 'home.physician.patients' : 'home.physician.patientsArea', { unit: ctx.unit?.name ?? '' })}
                note={assigned.length ? null : t('home.physician.notAssigned')} />
              <section className="card" aria-labelledby="ph-q">
                <div className="card-head"><h2 id="ph-q">{t('home.physician.questions')}</h2><Link className="linkbtn small" href="/tasks/visit">{t('visit.title')} →</Link></div>
                {qs.length ? (
                  <ul className="list">
                    {qs.slice(0, 10).map((q) => {
                      const r = nameOf(q.residentId)
                      return (
                        <li key={q.dto.id}>
                          <Link className="li" href={`/tasks/visit?r=${q.residentId}`}>
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
            </div>
            <div className="stack">
              <PendingOrders t={t} items={board.pending} hrefOf={(rid) => (canMeds ? `/residents/${rid}/meds#orders` : `/residents/${rid}`)} />
              <UpcomingVisits t={t} items={board.appointments} hrefOf={(rid) => `/tasks/visit?r=${rid}`} />
              <ForYou ctx={ctx} now={now} unitId={null} />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
