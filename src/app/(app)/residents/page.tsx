import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { fmtDate, fmtNum, fmtRel, hm } from '@/lib/time'
import { Admit } from './Admit'
import { floorOverview } from './_lib/floor'

export async function generateMetadata() {
  return { title: (await getCtx()).t('nav.residents') }
}

/**
 * Stockwerksübersicht, wenn keine Person gewählt ist: was auf dem Bereich jetzt wichtig ist (kritische Punkte,
 * Belegung, Dienst, Termine, Abwesende, Hinweise). Die Personen selbst stehen in der Liste links.
 */
export default async function ResidentsPage({ searchParams }: { searchParams: Promise<{ pick?: string }> }) {
  const ctx = await getCtx()
  const { t, unit, locale } = ctx
  if (!ctx.can('resident.read')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const pick = sp.pick === 'notes' || sp.pick === 'vitals' ? sp.pick : null
  const unitIds = unit ? [unit.id] : ctx.unitIds
  const now = new Date()
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
  const dm = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit' })

  const f = await floorOverview(ctx, unitIds, now)
  const freeRooms = unit
    ? (await db.room.findMany({ where: { unitId: unit.id }, include: { residents: { where: { status: { in: ['active', 'absent'] } }, select: { id: true } } }, orderBy: { number: 'asc' } }))
        .filter((r) => r.residents.length < r.beds)
        .map((r) => ({ id: r.id, label: `${r.number}${r.beds > 1 ? ` (${r.residents.length}/${r.beds})` : ''}` }))
    : []
  const canAdmit = !!unit && ctx.canHere('resident.create')
  const href = (id: string) => `/residents/${id}${pick ? '/' + pick : ''}`
  const n = f.notes
  const hasNotes = n.reaNo.length + n.allergies.length + n.risks.length + n.wounds.length + n.recent.length > 0

  // kritische Punkte pro Person gebündelt
  const groups: { key: string; who: string; href: string; lines: { text: string; tone: string; href: string }[] }[] = []
  for (const i of f.items) {
    const key = i.rid ?? i.who
    const g = groups.find((x) => x.key === key)
    if (g) g.lines.push({ text: i.text, tone: i.tone, href: i.href })
    else groups.push({ key, who: i.who, href: i.href, lines: [{ text: i.text, tone: i.tone, href: i.href }] })
  }

  return (
    <main className="panel main">
      <div className="view-head">
        <div>
          <span className="lbl">{unit ? unit.location.name : ctx.org.name}</span>
          <h1>{unit ? unit.name : t('residents.list.title')}</h1>
          <p className="sub">
            {t('residents.unit.count', { n: f.counts.residents })}
            {f.counts.beds > 0 && ' · ' + t('residents.unit.freeRooms', { n: f.counts.roomsFree })}
            {unit?.phone && <> · <a href={`tel:${unit.phone.replace(/\s/g, '')}`}>{unit.phone}</a></>}
          </p>
        </div>
        {canAdmit && <Admit rooms={freeRooms} unitName={unit!.name} />}
      </div>
      <div className="scroll">
        <div className="tabpanel">
          {pick && (
            <div className="alert info" role="status">
              <span className="grow">{t(pick === 'vitals' ? 'residents.unit.pickVitals' : 'residents.unit.pickNotes')}</span>
            </div>
          )}

          <div className="metrics" aria-label={t('residents.floor.title')}>
            <div className="metric">
              <span className="lbl">{t('home.residentsLabel')}</span>
              <span className="val">{f.counts.active}{f.counts.absent > 0 && <small> · {t('residents.floor.absentN', { n: f.counts.absent })}</small>}</span>
            </div>
            <div className="metric">
              <span className="lbl">{t('residents.floor.beds')}</span>
              <span className="val">{f.counts.beds ? <>{f.counts.occupied}<small>/{f.counts.beds}</small></> : '–'}{f.counts.freeBeds > 0 && <small> · {t('residents.floor.freeN', { n: f.counts.freeBeds })}</small>}</span>
            </div>
            {f.tasks ? (
              <Link className="metric" href="/tasks">
                <span className="lbl">{t('residents.unit.tasks')}</span>
                <span className={'val' + (f.tasks.total && f.tasks.done === f.tasks.total ? ' ok' : '')}>{f.tasks.done}<small>/{f.tasks.total} {t('residents.floor.done')}</small></span>
              </Link>
            ) : null}
            {f.tasks ? (
              <Link className="metric" href="/tasks?f=over">
                <span className="lbl">{t('home.overdue')}</span>
                <span className={'val' + (f.tasks.overdue ? ' crit' : '')}>{f.tasks.overdue}</span>
              </Link>
            ) : null}
            <a className="metric" href="#floor-crit">
              <span className="lbl">{t('residents.floor.alerts')}</span>
              <span className={'val' + (f.alerts ? ' crit' : '')}>{f.alerts}</span>
            </a>
            <div className="metric">
              <span className="lbl">{t('residents.floor.careLevel')}</span>
              <span className="val">{f.careLevel != null ? fmtNum(f.careLevel, 1, locale) : '–'}</span>
            </div>
          </div>

          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))' }}>
            <div className="stack">
              <section className={'card' + (groups.length ? ' crit' : '')} aria-labelledby="floor-crit">
                <div className="card-head">
                  <h2 id="floor-crit">{t('residents.floor.now')}</h2>
                  <span className={'pill' + (groups.length ? ' crit' : ' ok')}>{groups.length ? groups.length : '✓'}</span>
                </div>
                {groups.length ? (
                  <ul className="list">
                    {groups.slice(0, 12).map((g) => (
                      <li key={g.key}>
                        <Link className="li" href={g.href}>
                          <div className="grow">
                            <div>{g.who}</div>
                            {g.lines.map((l, i) => <div key={i} className={'small ' + (l.tone === 'crit' ? 'crit-text' : 'warn-text')}>{l.text}</div>)}
                          </div>
                          <span className="muted" aria-hidden="true">→</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('residents.floor.nowNone')}</div>}
                {groups.length > 12 && <div className="card-body small muted">{t('residents.floor.more', { n: groups.length - 12 })}</div>}
              </section>

              {(f.rooms.length > 0 || f.withoutRoom.length > 0) && (
                <section className="card" aria-labelledby="floor-rooms">
                  <div className="card-head">
                    <h2 id="floor-rooms">{t('residents.floor.rooms')}</h2>
                    <span className="small muted floor-legend"><span className="dot" aria-hidden="true" />{t('residents.floor.roomsLegend')}</span>
                  </div>
                  <ul className="floor-rooms">
                    {f.rooms.map((r) => (
                      <li key={r.id} className={'floor-room' + (r.people.length ? '' : ' free')}>
                        <span className="num">{r.number}{r.beds > 1 && <span className="muted"> · {r.people.length}/{r.beds}</span>}</span>
                        {r.people.length ? r.people.map((p) => (
                          <Link key={p.id} href={href(p.id)} className={'floor-person' + (p.absent ? ' absent' : '')}>
                            {(p.alert || p.overdue > 0) && <span className="dot crit" aria-hidden="true" />}
                            <span className="grow">{p.name}</span>
                            {p.absent && <span className="tag accent">{t('residents.banner.absent')}</span>}
                            {(p.alert || p.overdue > 0) && <span className="sr-only">{t('residents.floor.attention')}</span>}
                          </Link>
                        )) : <span className="small">{t('residents.floor.free')}</span>}
                      </li>
                    ))}
                    {f.withoutRoom.map((p) => (
                      <li key={p.id} className="floor-room">
                        <span className="num">{t('residents.floor.noRoom')}</span>
                        <Link href={href(p.id)} className={'floor-person' + (p.absent ? ' absent' : '')}><span className="grow">{p.name}</span></Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <div className="stack">
              {f.shifts && (
                <section className="card" aria-labelledby="floor-duty">
                  <div className="card-head">
                    <h2 id="floor-duty">{t('residents.floor.duty')}</h2>
                    <Link className="linkbtn small" href="/schedule">{t('nav.schedule')} →</Link>
                  </div>
                  {f.shifts.length ? (
                    <ul className="list">
                      {f.shifts.map((s) => (
                        <li key={s.code} className="li">
                          <span className="tag mono" style={{ minWidth: 34, justifyContent: 'center' }}>{s.code}</span>
                          <div className="grow">
                            <div>
                              {s.name} <span className="small muted mono">{s.time}</span>
                              {s.running && <> <span className="pill ok">{t('residents.floor.running')}</span></>}
                            </div>
                            <div className="small">
                              {s.staff.length ? s.staff.map((p, i) => (
                                <span key={i} className="nowrap">{i > 0 && ', '}{p.name} <span className="muted">({t('residents.floor.group.' + p.group)})</span></span>
                              )) : <span className="muted">{t('residents.floor.nobody')}</span>}
                            </div>
                          </div>
                          {s.open > 0 && <span className="tag warn nowrap">{t('residents.floor.openShifts', { n: s.open })}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : <div className="card-body small muted">{t('residents.floor.noShifts')}</div>}
                  {f.handover && (
                    <div className="card-body small" style={{ borderTop: '1px solid var(--line)' }}>
                      {t('residents.floor.handover', { shift: f.handover.shift })}:{' '}
                      {f.handover.submitted >= f.handover.units && f.handover.at
                        ? <span>✓ {t('home.lead.handoverDone', { at: rel(f.handover.at) })}</span>
                        : <Link href="/handover" className="tag warn">{t('home.lead.handoverOpen')}</Link>}
                    </div>
                  )}
                </section>
              )}

              <section className="card" aria-labelledby="floor-today">
                <div className="card-head"><h2 id="floor-today">{t('residents.floor.today')}</h2><span className="small muted">{f.agenda.length}</span></div>
                {f.agenda.length ? (
                  <ul className="list">
                    {f.agenda.map((a) => (
                      <li key={a.key}>
                        <Link className="li" href={a.href}>
                          <span className="mono small" style={{ minWidth: 42 }}>{hm(a.at)}</span>
                          <div className={'grow' + (a.done ? ' muted' : '')}>
                            <div>{a.who}</div>
                            <div className="small">{a.done && '✓ '}{a.text}</div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <div className="card-body small muted">{t('residents.floor.todayNone')}</div>}
              </section>

              {f.absent.length > 0 && (
                <section className="card" aria-labelledby="floor-absent">
                  <div className="card-head"><h2 id="floor-absent">{t('residents.floor.absent')}</h2><span className="small muted">{f.absent.length}</span></div>
                  <ul className="list">
                    {f.absent.map((a) => (
                      <li key={a.id}>
                        <Link className="li" href={href(a.id)}>
                          <div className="grow">
                            <div>{a.who}</div>
                            <div className="small muted">
                              {[a.reason, a.since && t('residents.floor.since', { date: dm(a.since) }), a.back && t('residents.floor.back', { date: dm(a.back) })].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {hasNotes && (
                <section className="card" aria-labelledby="floor-notes">
                  <div className="card-head"><h2 id="floor-notes">{t('residents.floor.notes')}</h2></div>
                  <dl className="floor-notes">
                    {n.reaNo.length > 0 && (
                      <div><dt><span className="tag outline">{t('residents.list.reaNo')}</span></dt>
                        <dd>{n.reaNo.map((p, i) => <span key={p.id}>{i > 0 && ', '}<Link href={href(p.id)}>{p.who}</Link></span>)}</dd></div>
                    )}
                    {n.allergies.length > 0 && (
                      <div><dt><span className="tag crit">{t('residents.list.allergy')}</span></dt>
                        <dd>{n.allergies.map((p, i) => <span key={p.id}>{i > 0 && '; '}<Link href={href(p.id)}>{p.who}</Link> <span className="muted">({p.text})</span></span>)}</dd></div>
                    )}
                    {n.wounds.length > 0 && (
                      <div><dt><span className="tag warn">{t('residents.floor.wounds')}</span></dt>
                        <dd>{n.wounds.map((p, i) => <span key={p.id}>{i > 0 && '; '}<Link href={`/residents/${p.id}/wounds`}>{p.who}</Link> <span className="muted">({p.text})</span></span>)}</dd></div>
                    )}
                    {n.risks.map((r) => (
                      <div key={r.name}><dt><span className="tag warn">{r.name}</span> <span className="small muted">{r.people.length}</span></dt>
                        <dd>{r.people.map((p, i) => <span key={p.id}>{i > 0 && ', '}<Link href={href(p.id)}>{p.who}</Link></span>)}</dd></div>
                    ))}
                    {n.recent.length > 0 && (
                      <div><dt><span className="tag accent">{t('residents.floor.recent')}</span></dt>
                        <dd>{n.recent.map((p, i) => <span key={p.id}>{i > 0 && ', '}<Link href={href(p.id)}>{p.who}</Link> <span className="muted">({dm(p.at)})</span></span>)}</dd></div>
                    )}
                  </dl>
                </section>
              )}

              {f.incidentsOpen > 0 && ctx.can('quality.report') && (
                <Link className="alert warn" href="/quality">
                  <span className="grow">{t('residents.floor.incidentsOpen', { n: f.incidentsOpen })}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
