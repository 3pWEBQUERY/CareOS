import Link from 'next/link'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { Avatar } from '@/components/people/Avatar'
import { loadPerson } from '@/lib/people'
import { certState } from '@/lib/learn'
import { fmtDate, weekdayShort, fmtDayMonth } from '@/lib/time'
import { TodayTag } from '../PeopleDirectory'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  const p = ctx.can('team.read') ? await loadPerson(ctx, (await params).id) : null
  return { title: p ? `${p.person.firstName} ${p.person.lastName} · ${t('people.title')}` : t('people.title') }
}

/** Mitarbeiterprofil (PRD §55, §61): Funktion, Bereich, Qualifikationen, Kontakt, Dienst heute – nach Berechtigung. */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('team.read')) return <Forbidden text={t('common.notAllowed')} />
  const { id } = await params
  const data = await loadPerson(ctx, id)
  if (!data) {
    return (
      <main className="panel main" style={{ flex: 1 }}>
        <div className="view-head"><div><Link href="/team/people" className="lbl" style={{ textDecoration: 'none' }}>← {t('people.profile.back')}</Link><h1>{t('people.title')}</h1></div></div>
        <div className="scroll"><div className="tabpanel"><div className="alert warn"><span className="grow">{t('people.profile.notFound')}</span></div></div></div>
      </main>
    )
  }
  const { person: p, access, today, upcoming, certs, enrollments } = data
  const now = new Date()
  const d = (x: Date) => fmtDate(x, locale)
  const tel = (n: string) => 'tel:' + n.replace(/[^\d+]/g, '')
  const chat = ctx.can('chat.use') && !access.self && p.active

  const validity = (until: Date | null, keys: { valid: string; expiring: string; expired: string }) => {
    if (!until) return null
    const s = certState(until, now)
    return <span className={'tag ' + (s === 'expired' ? 'crit' : s === 'expiring' ? 'warn' : '')}>{t(s === 'expired' ? keys.expired : s === 'expiring' ? keys.expiring : keys.valid, { date: d(until) })}</span>
  }

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div className="row ppl-head">
          <Avatar src={p.avatar} initials={p.initials} size="xl" />
          <div style={{ minWidth: 0 }}>
            <Link href="/team/people" className="lbl" style={{ textDecoration: 'none' }}>← {t('people.profile.back')}</Link>
            <h1>{p.firstName} {p.lastName}</h1>
            <p className="sub">{[p.jobTitle, p.primaryUnit].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div className="row">
          {access.adminLink && <Link className="btn ghost" href={`/admin/users/${p.id}`}>{t('people.profile.account')}</Link>}
          {p.workPhone && !access.self && <a className="btn" href={tel(p.workPhone)}>{t('people.profile.call')}</a>}
          {access.self && <Link className="btn" href="/profile#p-people">{t('people.profile.edit')}</Link>}
          {chat && <Link className="btn primary" href={`/chat?with=${p.id}`}>{t('people.profile.message')}</Link>}
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          {!p.active && <div className="alert warn"><span className="grow">{t('people.profile.inactive')}</span></div>}
          {access.self && <div className="alert info"><span className="grow">{t('people.profile.self')}</span></div>}
          <div className="grid-2">
            <div className="stack">
              <section className="card" aria-labelledby="pp-contact">
                <div className="card-head"><h2 id="pp-contact">{t('people.contact.title')}</h2></div>
                <div className="card-body">
                  <dl className="kv">
                    <dt>{t('people.contact.email')}</dt><dd><a href={'mailto:' + p.email}>{p.email}</a></dd>
                    {p.workPhone && <><dt>{t('people.contact.workPhone')}</dt><dd><a className="mono" href={tel(p.workPhone)}>{p.workPhone}</a></dd></>}
                    {p.phone && (
                      <>
                        <dt>{t('people.contact.privatePhone')}</dt>
                        <dd>
                          <a className="mono" href={tel(p.phone)}>{p.phone}</a>
                          <span className="small muted" style={{ display: 'block' }}>{t(p.phoneShared ? 'people.contact.shared' : 'people.contact.restricted')}</span>
                        </dd>
                      </>
                    )}
                    {p.primaryUnit && <><dt>{t('people.contact.primaryUnit')}</dt><dd>{p.primaryUnit}</dd></>}
                  </dl>
                </div>
              </section>

              {access.shifts && (
                <section className="card" aria-labelledby="pp-shift">
                  <div className="card-head"><h2 id="pp-shift">{t('people.shifts.title')}</h2>{access.self && <Link className="linkbtn small" href="/schedule">{t('people.shifts.toSchedule')} →</Link>}</div>
                  <div className="card-body stack-sm">
                    <div>
                      {today ? (
                        today.kind === 'absent'
                          ? <span className="tag outline">{t('people.today.absent')}{today.reason ? ' · ' + t('schedule.absence.kinds.' + today.reason) : ''}</span>
                          : <span className="row" style={{ gap: 8 }}><TodayTag today={today} /><span className="small muted">{today.unit}</span></span>
                      ) : <span className="muted">{t('people.today.off')}</span>}
                    </div>
                    <span className="lbl">{t('people.shifts.next')}</span>
                    {upcoming.length ? (
                      <ul className="ppl-shifts">
                        {upcoming.map((s) => (
                          <li key={s.id}>
                            <span className="mono small ppl-day">{weekdayShort(s.date, locale)} {fmtDayMonth(s.date, locale)}</span>
                            <span className={'sh ' + s.code}>{s.code}</span>
                            <span className="small mono">{s.start}–{s.end}</span>
                            <span className="small muted">{s.unit}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <span className="small muted">{t('people.shifts.none')}</span>}
                  </div>
                </section>
              )}
            </div>

            <div className="stack">
              <section className="card" aria-labelledby="pp-work">
                <div className="card-head"><h2 id="pp-work">{t('people.work.title')}</h2></div>
                <div className="card-body">
                  <dl className="kv">
                    <dt>{t('people.work.jobTitle')}</dt><dd>{p.jobTitle ?? '–'}</dd>
                    {p.roles.length > 0 && <><dt>{t('people.work.roles')}</dt><dd>{p.roles.map((r, i) => <span key={i} style={{ display: 'block' }}>{r.name} <span className="small muted">· {r.scope ?? t('people.work.org')}</span></span>)}</dd></>}
                    {p.teams.length > 0 && <><dt>{t('people.work.teams')}</dt><dd>{p.teams.join(', ')}</dd></>}
                  </dl>
                </div>
              </section>

              <section className="card" aria-labelledby="pp-quals">
                <div className="card-head"><h2 id="pp-quals">{t('people.quals.title')}</h2></div>
                {p.qualifications.length ? (
                  <ul className="list">
                    {p.qualifications.map((q) => (
                      <li key={q.id}>
                        <div className="li" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <div className="grow"><div>{q.name}</div><div className="small muted">{t('people.quals.level', { n: q.level })}</div></div>
                          {validity(q.validUntil, { valid: 'people.quals.validUntil', expiring: 'people.quals.expiring', expired: 'people.quals.expired' })}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('people.quals.none')}</div>}
              </section>

              {access.training && (
                <section className="card" aria-labelledby="pp-train">
                  <div className="card-head">
                    <h2 id="pp-train">{t('people.training.title')}</h2>
                    <Link className="linkbtn small" href={access.self ? '/learn/certificates' : '/learn/compliance'}>{t(access.self ? 'people.training.mine' : 'people.training.compliance')} →</Link>
                  </div>
                  <div className="card-body stack-sm">
                    <span className="lbl">{t('people.training.open')}</span>
                    {enrollments.length ? (
                      <ul className="list ppl-sublist">
                        {enrollments.map((e) => {
                          const overdue = !!e.dueAt && e.dueAt < now
                          return (
                            <li key={e.id} className="li" style={{ alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
                              <span className="grow">{access.self ? <Link href={`/learn/${e.course.id}`}>{e.course.title}</Link> : e.course.title}</span>
                              {e.course.mandatory && <span className="tag outline">{t('people.training.mandatory')}</span>}
                              {e.dueAt && <span className={'tag ' + (overdue ? 'crit' : '')}>{t(overdue ? 'people.training.overdue' : 'people.training.due', { date: d(e.dueAt) })}</span>}
                            </li>
                          )
                        })}
                      </ul>
                    ) : <span className="small muted">{t('people.training.noOpen')}</span>}
                    <span className="lbl">{t('people.training.certs')}</span>
                    {certs.length ? (
                      <ul className="list ppl-sublist">
                        {certs.map((c) => (
                          <li key={c.id} className="li" style={{ alignItems: 'center', flexWrap: 'wrap', padding: '6px 0' }}>
                            <span className="grow">{c.title} <span className="small muted mono">{d(c.issuedAt)}</span></span>
                            {validity(c.expiresAt, { valid: 'people.training.valid', expiring: 'people.training.expiring', expired: 'people.training.expired' }) ?? <span className="tag">{t('people.training.unlimited')}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : <span className="small muted">{t('people.training.noCerts')}</span>}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
