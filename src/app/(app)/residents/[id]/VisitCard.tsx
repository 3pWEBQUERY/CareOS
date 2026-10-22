import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, fmtDayMonth, hm, sameDay, startOfDay } from '@/lib/time'
import { askRefOptions, openQuestions } from '@/lib/visit-data'
import { AskQuestion, WithdrawQuestion } from '@/components/visit/AskQuestion'

/**
 * Vorbereitung der Arztvisite in der Akte (PRD §29, §47): offene Fragen der Pflege, nächster Visitentermin,
 * «Frage vormerken». Antworten entstehen in der Visite (/tasks/visit).
 */
export async function VisitCard({ ctx, r, canWrite }: { ctx: Ctx; r: { id: string; firstName: string; lastName: string; unitId: string; room: { number: string } | null }; canWrite: boolean }) {
  const { t } = ctx
  const now = new Date()
  const [qs, next, options] = await Promise.all([
    openQuestions(ctx, [r.id], now),
    db.appointment.findFirst({ where: { residentId: r.id, kind: 'physician', done: false, at: { gte: startOfDay(now), lt: addDays(now, 60) } }, orderBy: { at: 'asc' } }),
    canWrite ? askRefOptions(ctx, r.id, now) : Promise.resolve([]),
  ])
  const who = `${r.lastName} ${r.firstName} · ${t('residents.banner.room')} ${r.room?.number ?? '–'}`
  const when = next ? (sameDay(next.at, now) ? `${t('common.today')} ${hm(next.at)}` : `${fmtDayMonth(next.at)} ${hm(next.at)}`) : null
  const inUnit = ctx.unit?.id === r.unitId
  return (
    <section className="card" aria-labelledby="ov-visit">
      <div className="card-head">
        <div className="row" style={{ gap: 10 }}>
          <h2 id="ov-visit">{t('visit.card.title')}</h2>
          <span className="small muted">{when ? t('visit.card.next', { when }) : t('visit.card.noNext')}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {inUnit && (qs.length > 0 || next) && <Link className="linkbtn small" href={`/tasks/visit?r=${r.id}`}>{t('visit.card.toVisit')} →</Link>}
          {canWrite && <AskQuestion residentId={r.id} who={who} options={options} />}
        </div>
      </div>
      {qs.length ? (
        <ul className="list">
          {qs.map(({ dto: q }) => (
            <li key={q.id} className="li" style={{ alignItems: 'center' }}>
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 400 }}>{q.text}</span>
                <span className="small muted">{q.ref && <><Link className="linkbtn small" href={q.ref.href}>{q.ref.label}</Link> · </>}{t('visit.overview.askedBy', { by: q.by, when: q.when })}</span>
              </span>
              {canWrite && <WithdrawQuestion residentId={r.id} questionId={q.id} text={q.text} who={who} />}
            </li>
          ))}
        </ul>
      ) : <div className="card-body small muted">{t('visit.card.empty')}</div>}
    </section>
  )
}
