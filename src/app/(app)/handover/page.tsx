import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { aiConfigured } from '@/lib/env'
import { lastShiftEnd, shiftTypes } from '@/lib/shift'
import { addDays, dateKey, dbDate, fmtDayMonth, fmtRel, hm, parseDateKey, sameDay, shiftBounds, startOfDay } from '@/lib/time'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { HandoverActions, HandoverCard, type HoBlockDto } from '@/components/handover/HandoverUi'
import { collectHandover, runningAndPrevious } from './collect'

export const metadata = { title: 'Übergabe' }

const LIMIT = 6

/** CareOS Handover (PRD §11): automatische Schichtübergabe mit Ergänzungen und Kenntnisnahme. */
export default async function HandoverPage({ searchParams }: { searchParams: Promise<{ s?: string; d?: string; since?: string }> }) {
  const sp = await searchParams
  const ctx = await getCtx()
  const { t, unit, user } = ctx
  if (!unit) return <main className="panel main" style={{ flex: 1 }}><div className="tabpanel"><Empty title={t('tasks.noUnit')} /></div></main>
  if (!ctx.canHere('handover.read')) return <Forbidden text={t('common.notAllowed')} />
  const canWrite = ctx.canHere('handover.write')
  const now = new Date()
  const types = await shiftTypes(ctx.org.id)
  if (!types.length) return <main className="panel main" style={{ flex: 1 }}><div className="tabpanel"><Empty title={t('tasks.handover.noShifts')} /></div></main>

  // Gewählte Schicht: ?s=Code&d=Startdatum; sonst die vorangehende Schicht in den ersten 2 Stunden eines Dienstes, danach die laufende.
  const { running, previous, occ } = runningAndPrevious(types, now)
  const latestOf = (code: string) => occ.filter((o) => o.def.code === code && o.start <= now).sort((a, b) => b.start.getTime() - a.start.getTime())[0] ?? occ.find((o) => o.def.code === code)!
  let sel = running && now.getTime() - running.start.getTime() < 2 * 3600_000 && previous ? previous : running ?? previous ?? occ[0]
  const pickDef = types.find((s) => s.code === sp.s)
  if (pickDef) {
    const d = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? parseDateKey(sp.d) : null
    sel = d ? { def: pickDef, ...shiftBounds(pickDef, d) } : latestOf(pickDef.code)
  }
  const shiftDay = startOfDay(sel.start)
  const target = { shiftCode: sel.def.code, date: dateKey(shiftDay) }
  const future = sel.start > now
  const runningNow = sel.start <= now && now < sel.end
  const since = sp.since === '1'
  const last = since ? await lastShiftEnd(user.id, ctx.sessionId, now) : null
  const from = last ? last.at : sel.start
  const to = last ? now : sel.end

  const handover = await db.handover.findUnique({ where: { unitId_shiftCode_date: { unitId: unit.id, shiftCode: sel.def.code, date: dbDate(shiftDay) } } })
  const blocks = await collectHandover(ctx, unit.id, from, to, handover?.id ?? null, now)
  const acks = handover ? await db.acknowledgement.findMany({ where: { subjectType: 'handover', subjectId: handover.id }, include: { user: { select: { initials: true } } }, orderBy: { at: 'asc' } }) : []
  const author = handover?.authorId ? await db.user.findUnique({ where: { id: handover.authorId }, select: { firstName: true, lastName: true } }) : null
  const myAcks = new Map(acks.filter((a) => a.userId === user.id).map((a) => [a.version, a]))

  const dto: HoBlockDto[] = blocks.map((b) => {
    const cut = (k: keyof HoBlockDto['cols']) => b[k].slice(0, LIMIT)
    const ack = myAcks.get(b.resident.id)
    return {
      resident: {
        id: b.resident.id, name: `${b.resident.lastName} ${b.resident.firstName}`, room: b.resident.room, allergies: b.resident.allergies,
        meta: [b.resident.careLevel != null ? t('tasks.handover.careLevel', { n: b.resident.careLevel }) : null, b.resident.rea === 'no' ? t('residents.banner.reaNo') : null].filter(Boolean).join(' · '),
      },
      cols: { happened: cut('happened'), done: cut('done'), watch: cut('watch'), open: cut('open') },
      more: { happened: Math.max(0, b.happened.length - LIMIT), done: Math.max(0, b.done.length - LIMIT), watch: Math.max(0, b.watch.length - LIMIT), open: Math.max(0, b.open.length - LIMIT) },
      entry: b.entry,
      acked: ack ? hm(ack.at) : null,
      others: acks.filter((a) => a.userId !== user.id && a.version === b.resident.id).map((a) => `${a.user.initials} ${hm(a.at)}`),
    }
  })
  const totals = blocks.reduce((s, b) => ({ notes: s.notes + b.counts.notes, open: s.open + b.counts.open, abnormal: s.abnormal + b.counts.abnormal }), { notes: 0, open: 0, abnormal: 0 })
  const ackN = dto.filter((b) => b.acked).length
  const importantOpen = dto.filter((b) => b.entry?.important && !b.acked).length
  const allAcked = myAcks.has('') && ackN === dto.length
  const aiAvailable = aiConfigured() && ctx.can('ai.use')
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)
  const href = (p: Record<string, string | null>) => {
    const q = new URLSearchParams()
    const v: Record<string, string | null> = { s: sp.s ?? null, d: sp.d ?? null, since: since ? '1' : null, ...p }
    for (const [k, val] of Object.entries(v)) if (val) q.set(k, val)
    const s = q.toString()
    return '/handover' + (s ? '?' + s : '')
  }
  const prevOcc = occ.filter((o) => o.start < sel.start).sort((a, b) => b.start.getTime() - a.start.getTime())[0]
  const prevHref = prevOcc ? href({ s: prevOcc.def.code, d: dateKey(startOfDay(prevOcc.start)) }) : href({ s: sel.def.code, d: dateKey(addDays(shiftDay, -1)) })

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">
        <div>
          <span className="lbl">{t('tasks.handover.label')} · {unit.name}</span>
          <h1>{sel.def.name} {sel.def.start}–{sel.def.end}</h1>
          <p className="sub">
            {sameDay(shiftDay, now) ? t('common.today') : sameDay(shiftDay, addDays(now, -1)) ? t('common.yesterday') : ''} {fmtDayMonth(shiftDay)}
            {' · '}
            {handover?.submittedAt
              ? t('tasks.handover.status.submitted', { at: rel(handover.submittedAt), by: author ? `${author.firstName.charAt(0)}. ${author.lastName}` : '–' })
              : t(runningNow ? 'tasks.handover.status.running' : future ? 'tasks.handover.status.future' : 'tasks.handover.status.notSubmitted')}
          </p>
        </div>
        <div className="row">
          <Link className="btn ghost sm" href={prevHref} aria-label={t('tasks.handover.prevShift')} title={t('tasks.handover.prevShift')}>‹</Link>
          <nav className="seg seg-x" aria-label={t('tasks.handover.shift')}>
            {types.map((s) => {
              const o = latestOf(s.code)
              const active = s.code === sel.def.code && sameDay(startOfDay(o.start), shiftDay)
              return <Link key={s.code} href={href({ s: s.code, d: null })} aria-current={active ? 'page' : undefined} scroll={false}>{s.name.replace(/dienst$/i, '')}</Link>
            })}
          </nav>
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="row-between">
            <Link className="chip" href={href({ since: since ? null : '1' })} aria-pressed={since} scroll={false}>
              {since ? '✓ ' : ''}{t('tasks.handover.sinceLast')}
            </Link>
            <HandoverActions
              target={target}
              since={since}
              canAck={!future}
              canAckAll={!future}
              ackAllBlocked={importantOpen}
              allAcked={allAcked}
              canSubmit={canWrite && !future}
              submitted={!!handover?.submittedAt}
              note={handover?.note ?? null}
              aiAvailable={aiAvailable && !future}
              canWrite={canWrite}
            />
          </div>
          {since && last && <p className="small muted" style={{ margin: 0 }}>{t(last.source === 'shift' ? 'tasks.handover.sinceHint' : 'tasks.handover.sinceHintSession', { at: rel(last.at) })}</p>}
          {future && <p className="muted" style={{ margin: 0 }}>{t('tasks.handover.futureHint')}</p>}

          <div className="metrics">
            <div className="metric"><span className="lbl">{t('tasks.handover.metrics.notes')}</span><span className="val">{totals.notes}</span></div>
            <div className="metric"><span className="lbl">{t('tasks.handover.metrics.open')}</span><span className={'val' + (totals.open ? ' crit' : '')}>{totals.open}</span></div>
            <div className="metric"><span className="lbl">{t('tasks.handover.metrics.abnormal')}</span><span className={'val' + (totals.abnormal ? ' crit' : '')}>{totals.abnormal}</span></div>
            <div className="metric">
              <span className="lbl">{t('tasks.handover.metrics.acked')}</span>
              <span className="val">{ackN} <small>/ {dto.length}</small></span>
              <div className="bar"><i className={ackN === dto.length && dto.length ? 'ok' : ''} style={{ width: `${dto.length ? Math.round((ackN / dto.length) * 100) : 0}%` }} /></div>
            </div>
          </div>

          {handover?.note && (
            <section className="card">
              <div className="card-head"><h2>{t('tasks.handover.summary')}</h2>{author && <span className="small muted">{author.firstName.charAt(0)}. {author.lastName}</span>}</div>
              <div className="card-body" style={{ whiteSpace: 'pre-wrap' }}>{handover.note}</div>
            </section>
          )}
          {importantOpen > 0 && !future && (
            <div className="alert warn" role="status"><span className="grow"><strong>{t('tasks.handover.importantTitle', { n: importantOpen })}</strong>{t('tasks.handover.importantText')}</span></div>
          )}
          {handover?.submittedAt && canWrite && <p className="small muted" style={{ margin: 0 }}>{t('tasks.handover.lockedHint')}</p>}

          {dto.length ? (
            <div className="ho-list">
              {dto.map((b) => <HandoverCard key={b.resident.id} b={b} target={target} canAck={!future} canEdit={canWrite && !handover?.submittedAt && !future} />)}
            </div>
          ) : (
            <Empty title={t('tasks.handover.empty.residents')} />
          )}
        </div>
      </div>
    </main>
  )
}
