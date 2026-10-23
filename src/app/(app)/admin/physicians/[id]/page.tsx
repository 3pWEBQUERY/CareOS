import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { EXTERNAL_PHYSICIAN } from '@/lib/permissions'
import { INVITE_DAYS } from '@/lib/invites'
import { physicianAccount } from '@/lib/md/physicians'
import { assignmentActive } from '@/lib/md/scope'
import { physicianTextMatches } from '@/lib/md/text-match'
import { addDays, dateKey, fmtDate } from '@/lib/time'
import { Forbidden } from '@/components/ui/Empty'
import { AdminHead } from '../../Head'
import { AssignForm, EndAssignment, ExternalAccountActions, ImportFromText } from '../PhysicianClient'

export async function generateMetadata() {
  return { title: (await getCtx()).t('md.admin.title') }
}

/** Ärztin/Arzt: Konto, Zuordnungen (aktiv/abgelaufen), zuordnen, Übernahme aus dem Feld «Hausarzt». */
export default async function PhysicianDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('admin.users')) return <Forbidden text={t('common.notAllowed')} />
  const u = await physicianAccount(ctx, id)
  if (!u) notFound()
  const now = new Date()
  const ext = u.kind === EXTERNAL_PHYSICIAN
  const [rows, residents] = await Promise.all([
    db.residentPhysician.findMany({ where: { orgId: ctx.org.id, userId: u.id }, include: { resident: { select: { id: true, firstName: true, lastName: true, physician: true, room: { select: { number: true } }, unit: { select: { name: true } } } } }, orderBy: [{ until: 'asc' }, { createdAt: 'desc' }] }),
    db.resident.findMany({ where: { orgId: ctx.org.id, status: { in: ['active', 'absent'] } }, select: { id: true, firstName: true, lastName: true, physician: true, room: { select: { number: true } }, unit: { select: { name: true } } }, orderBy: [{ lastName: 'asc' }] }),
  ])
  const active = rows.filter((r) => assignmentActive(r, now))
  const past = rows.filter((r) => !assignmentActive(r, now)).filter((r) => r.until && r.until > addDays(now, -90))
  const assigned = new Set(active.map((r) => r.residentId))
  const suggest = residents.filter((r) => !assigned.has(r.id) && physicianTextMatches(r.physician, u))
  const name = (r: { firstName: string; lastName: string; room: { number: string } | null }) => [r.room?.number, `${r.lastName} ${r.firstName}`].filter(Boolean).join(' ')
  const options = residents.filter((r) => !assigned.has(r.id)).map((r) => ({ value: r.id, label: `${r.lastName} ${r.firstName}`, hint: [r.room?.number, r.unit.name, r.physician].filter(Boolean).join(' · ') }))

  return (
    <main className="panel main" style={{ flex: 1 }}>
      <AdminHead section={t('md.admin.detail.back')} href="/admin/physicians" title={`${u.lastName} ${u.firstName}`} sub={[u.jobTitle, u.email].filter(Boolean).join(' · ')}>
        {ext && <ExternalAccountActions userId={u.id} active={u.active} days={INVITE_DAYS} />}
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          <div className="alert info"><span className="grow">{t(ext ? 'md.admin.detail.externalHint' : 'md.admin.detail.internalHint')}</span></div>
          {suggest.length > 0 && (
            <div className="alert warn">
              <span className="grow">{t('md.admin.detail.suggestHint', { n: suggest.length, name: u.lastName })}</span>
              <ImportFromText userId={u.id} label={t('md.admin.detail.suggest')} />
            </div>
          )}
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
            <section className="card" aria-labelledby="pa-list">
              <div className="card-head"><h2 id="pa-list">{t('md.admin.detail.assignments')}</h2><span className="small muted">{active.length}</span></div>
              {active.length ? (
                <ul className="list">
                  {active.map((a) => (
                    <li key={a.id} className="li">
                      <span className="grow">{name(a.resident)}<span className="small muted" style={{ display: 'block' }}>{a.resident.unit.name} · {t('md.admin.roles.' + a.role)} · {t('md.admin.detail.since', { date: fmtDate(a.from, locale) })}{a.until && ` · ${t('md.admin.detail.untilDate', { date: fmtDate(addDays(a.until, -1), locale) })}`}</span></span>
                      <EndAssignment id={a.id} name={`${a.resident.lastName} ${a.resident.firstName}`} />
                    </li>
                  ))}
                </ul>
              ) : <div className="card-body small muted">{t('md.admin.detail.none')}</div>}
              {past.length > 0 && (
                <ul className="list">
                  {past.map((a) => <li key={a.id} className="li muted"><span className="grow small">{name(a.resident)} · {t('md.admin.detail.untilDate', { date: fmtDate(a.until!, locale) })}</span></li>)}
                </ul>
              )}
            </section>
            <section className="card" aria-labelledby="pa-add">
              <div className="card-head"><h2 id="pa-add">{t('md.admin.detail.add')}</h2></div>
              <div className="card-body"><AssignForm userId={u.id} residents={options} todayKey={dateKey(now)} /></div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
