import Link from 'next/link'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { addDays, dbDate, fmtDayMonth, fromDbDate } from '@/lib/time'
import { inAudience, roleKeysByUserIds } from '@/lib/audience'

/**
 * «Für dich» (PRD §2.1 Mitteilungen, Weisungen, Schulungen, Dienste) – gleich für alle Rollen.
 * `extra`: zusätzliche Bestätigungen der Ansicht (z. B. Übergabe, wichtige Verlaufseinträge) als <li>.
 */
export async function ForYou({ ctx, now, extra, extraCount = 0, unitId }: { ctx: Ctx; now: Date; extra?: React.ReactNode; extraCount?: number; unitId?: string | null }) {
  const { t, user, locale } = ctx
  const [posts, docs, enrollments, nextShifts, openShifts] = await Promise.all([
    ctx.can('team.read')
      ? db.post.findMany({ where: { requireAck: true, channel: { orgId: ctx.org.id, archived: false, OR: [{ unitId: null }, { unitId: { in: ctx.unitIds } }] }, publishedAt: { gte: addDays(now, -60) } }, orderBy: { publishedAt: 'desc' } })
      : [],
    ctx.can('docs.read') ? db.document.findMany({ where: { orgId: ctx.org.id, status: 'approved', requireAck: true } }) : [],
    ctx.can('learn.read')
      ? db.enrollment.findMany({ where: { userId: user.id, status: { in: ['assigned', 'in_progress', 'expired'] } }, include: { course: true }, orderBy: { dueAt: 'asc' } })
      : [],
    db.shift.findMany({ where: { userId: user.id, date: { gte: dbDate(now), lte: dbDate(addDays(now, 14)) }, status: { not: 'cancelled' } }, include: { shiftType: true }, orderBy: { date: 'asc' }, take: 5 }),
    unitId && ctx.can('schedule.read') ? db.shift.count({ where: { unitId, status: 'open', date: { gte: dbDate(now) } } }) : 0,
  ])
  const acks = await db.acknowledgement.findMany({
    where: { userId: user.id, OR: [{ subjectType: 'post', subjectId: { in: posts.map((p) => p.id) } }, { subjectType: 'document', subjectId: { in: docs.map((d) => d.id) } }] },
    select: { subjectType: true, subjectId: true, version: true },
  })
  const acked = new Set(acks.map((a) => `${a.subjectType}:${a.subjectId}:${a.version}`))
  // Zielgruppen (Rollen) beachten: nur bestätigen, was an mich gerichtet ist.
  const myRoles = (await roleKeysByUserIds([user.id])).get(user.id) ?? new Set<string>()
  const postsToAck = posts.filter((p) => inAudience(p.audienceRoles, myRoles) && !acked.has(`post:${p.id}:`))
  const docsToAck = docs.filter((d) => inAudience(d.audienceRoles, myRoles) && !acked.has(`document:${d.id}:${d.currentVersion ?? ''}`))
  const trainingsOpen = enrollments.filter((e) => e.course.mandatory || e.dueAt)
  const canSchedule = ctx.can('schedule.read')

  return (
    <section className="card" aria-labelledby="foryou">
      <div className="card-head"><h2 id="foryou">{t('home.team')}</h2></div>
      <div className="card-body stack-sm">
        <span className="lbl">{t('home.toAck')}</span>
        {postsToAck.length + docsToAck.length + extraCount ? (
          <ul className="list">
            {extra}
            {postsToAck.map((p) => <li key={p.id}><Link className="li" href={`/team/post/${p.id}`}><span className="tag accent">{t('nav.team')}</span><span className="grow">{p.title}</span></Link></li>)}
            {docsToAck.map((d) => <li key={d.id}><Link className="li" href={`/docs/${d.id}`}><span className="tag violet">{t('nav.docs')}</span><span className="grow">{d.title} <span className="muted mono small">v{d.currentVersion}</span></span></Link></li>)}
          </ul>
        ) : <p className="small muted" style={{ margin: 0 }}>{t('home.ackNone')}</p>}

        {ctx.can('learn.read') && (
          <>
            <span className="lbl" style={{ marginTop: 6 }}>{t('home.trainings')}</span>
            {trainingsOpen.length ? (
              <ul className="list">
                {trainingsOpen.map((e) => {
                  const over = e.dueAt && e.dueAt < now
                  return (
                    <li key={e.id}><Link className="li" href={`/learn/${e.courseId}`}><span className="grow">{e.course.title}{e.course.mandatory && <span className="tag outline" style={{ marginLeft: 6 }}>{t('learn.mandatory')}</span>}</span>{e.dueAt && <span className={'small nowrap ' + (over ? 'crit-text' : 'muted')}>{t(over ? 'home.overdueSince' : 'home.dueIn', { date: fmtDayMonth(e.dueAt, locale) })}</span>}</Link></li>
                  )
                })}
              </ul>
            ) : <p className="small muted" style={{ margin: 0 }}>{t('home.trainingsNone')}</p>}
          </>
        )}

        {(nextShifts.length > 0 || canSchedule) && (
          <>
            <span className="lbl" style={{ marginTop: 6 }}>{t('home.nextShifts')}</span>
            {nextShifts.length ? (
              <div className="chips">
                {nextShifts.map((s) => {
                  const d = fromDbDate(s.date)
                  const label = <><span className={'sh ' + s.shiftType.code} style={{ marginRight: 6 }}>{s.shiftType.code}</span>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)} {fmtDayMonth(d, locale)}</>
                  return canSchedule ? <Link key={s.id} href="/schedule" className="chip">{label}</Link> : <span key={s.id} className="chip">{label}</span>
                })}
              </div>
            ) : <p className="small muted" style={{ margin: 0 }}>{t('home.nextShiftsNone')}</p>}
            {openShifts > 0 && <Link className="linkbtn small" href="/schedule?view=open">{t('home.openShifts', { n: openShifts })}</Link>}
          </>
        )}
      </div>
    </section>
  )
}
