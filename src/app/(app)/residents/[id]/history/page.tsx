import Link from 'next/link'
import { db } from '@/lib/db'
import { usersWithPermission } from '@/lib/notify'
import { dateKey, fmtDate, fromDbDate, hm } from '@/lib/time'
import { pageResident, userNames, residentTitle } from '../../_lib/resident'
import { EditMaster } from './EditMaster'
import { FormDialog } from '@/components/admin/ui'
import { anonymiseResidentAction } from './actions'

const ACTIONS = [
  'resident.view', 'resident.create', 'resident.update', 'resident.file.attach', 'observation.create', 'observation.correct', 'vitals.create', 'vitals.thresholds',
  'task.complete', 'task.reopen', 'task.document', 'task.create', 'appointment.create', 'appointment.update', 'contact.create', 'contact.update', 'contact.delete', 'file.upload',
  'resident.export', 'resident.anonymise', 'task.escalate', 'handover.escalate',
]
const FIELDS = [
  'firstName', 'lastName', 'birthDate', 'sex', 'roomId', 'careLevel', 'physician', 'rea', 'allergies', 'risks', 'diet', 'mobility', 'status', 'importantNotes', 'insuranceNo',
  'primaryNurseId', 'dischargedAt', 'text', 'category', 'important', 'title', 'note', 'done', 'at', 'kind', 'place', 'notes', 'name', 'relation', 'phone', 'email', 'isEmergency', 'isLegalRep',
  'completedAt', 'completedById', 'authorId', 'recordedById', 'dueAt', 'reason', 'aiAssisted', 'abnormal', 'sys', 'dia', 'pulse', 'temp', 'spo2', 'glucose', 'weight', 'pain', 'respRate', 'priority', 'source',
]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return residentTitle((await params).id, 'history')
}

export default async function HistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ views?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, r, can } = await pageResident(id)
  const { t, locale } = ctx
  const withViews = sp.views === '1'
  const logs = await db.auditLog.findMany({
    where: {
      orgId: ctx.org.id,
      OR: [{ entityId: r.id }, { context: { path: ['residentId'], equals: r.id } }],
      ...(withViews ? {} : { action: { not: 'resident.view' } }),
    },
    orderBy: { at: 'desc' },
    take: 250,
  })
  // Benutzer- und Zimmer-IDs in Vorher/Nachher auflösen, technische IDs ausblenden.
  const USER_KEYS = ['completedById', 'authorId', 'primaryNurseId', 'recordedById', 'byId']
  const refIds = (key: string) => logs.flatMap((l) => [l.before, l.after]).map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : null)).filter((v): v is string => typeof v === 'string')
  const names = await userNames(ctx, [...logs.map((l) => l.userId), ...USER_KEYS.flatMap(refIds)])
  const roomRows = await db.room.findMany({ where: { id: { in: refIds('roomId') }, unit: { orgId: ctx.org.id } }, select: { id: true, number: true } })
  const roomNo = new Map(roomRows.map((x) => [x.id, x.number]))
  const actionLabel = (a: string) => (ACTIONS.includes(a) ? t('residents.history.actions.' + a.replace(/\./g, '_')) : a)
  const fieldLabel = (k: string) => (FIELDS.includes(k) ? t('residents.history.fields.' + k) : k)
  const val = (v: unknown): string => {
    if (v == null || v === '') return '–'
    if (typeof v === 'boolean') return t(v ? 'common.yes' : 'common.no')
    if (Array.isArray(v)) return v.length ? v.map(val).join(', ') : '–'
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v)
      return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? fmtDate(fromDbDate(d), locale) : `${fmtDate(d, locale)} ${hm(d)}`
    }
    if (typeof v === 'object') return JSON.stringify(v)
    const s = String(v)
    return s.length > 80 ? s.slice(0, 78) + ' …' : s
  }
  const ENUMS: Record<string, (v: string) => string | null> = {
    category: (v) => (['care', 'observation', 'physician', 'relatives', 'incident', 'handover'].includes(v) ? t('chart.cat.' + v) : null),
    status: (v) => (['done', 'partial', 'skipped'].includes(v) ? t('chart.day.statusText.' + v) : v === 'escalated' || v === 'in_progress' ? t('tasks.view.' + v) : v === 'planned' ? t('chart.day.subPlanned') : ['active', 'absent', 'discharged', 'deceased'].includes(v) ? t('residents.status.' + v) : null),
    rea: (v) => (v === 'yes' ? t('residents.banner.reaYes') : v === 'no' ? t('residents.banner.reaNo') : v === 'unknown' ? t('residents.banner.reaUnknown') : null),
    sex: (v) => (['f', 'm', 'd'].includes(v) ? t('residents.form.sex' + v.toUpperCase()) : null),
    kind: (v) => (['physician', 'therapy', 'hospital', 'relatives', 'other'].includes(v) ? t('residents.appointments.kinds.' + v) : null),
  }
  const show = (k: string, v: unknown) => {
    if (typeof v === 'string') {
      if (USER_KEYS.includes(k)) return names.get(v)?.short ?? '–'
      if (k === 'roomId') return roomNo.get(v) ?? '–'
      const e = ENUMS[k]?.(v)
      if (e) return e
    }
    return val(v)
  }
  const diff = (before: unknown, after: unknown) => {
    const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>
    const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
      .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
      .filter((k) => !k.endsWith('Id') || USER_KEYS.includes(k) || k === 'roomId')
    return keys.map((k) => ({ k, from: k in b ? show(k, b[k]) : null, to: k in a ? show(k, a[k]) : null }))
  }

  const canEdit = can('resident.edit')
  const canExport = canEdit || ctx.can('admin.org')
  const canAnonymise = ctx.can('admin.org')
  const leaver = r.status === 'discharged' || r.status === 'deceased'
  let editProps = null
  if (canEdit) {
    const [rooms, nurseIds] = await Promise.all([
      db.room.findMany({ where: { unitId: r.unitId }, include: { residents: { where: { status: { in: ['active', 'absent'] } }, select: { id: true } } }, orderBy: { number: 'asc' } }),
      usersWithPermission(ctx.org.id, 'resident.chart.write', r.unitId),
    ])
    const nurses = await db.user.findMany({ where: { id: { in: nurseIds }, orgId: ctx.org.id, active: true }, orderBy: { lastName: 'asc' }, select: { id: true, firstName: true, lastName: true, jobTitle: true } })
    editProps = {
      rooms: rooms.filter((x) => x.id === r.roomId || x.residents.length < x.beds).map((x) => ({ id: x.id, label: x.number + (x.beds > 1 ? ` (${x.residents.filter((y) => y.id !== r.id).length}/${x.beds})` : '') })),
      nurses: nurses.map((n) => ({ id: n.id, label: `${n.lastName} ${n.firstName}${n.jobTitle ? ', ' + n.jobTitle : ''}` })),
      d: {
        firstName: r.firstName, lastName: r.lastName, birthDate: dateKey(fromDbDate(r.birthDate)), sex: r.sex, roomId: r.roomId, careLevel: r.careLevel,
        physician: r.physician, rea: r.rea, allergies: r.allergies, risks: r.risks, diet: r.diet, mobility: r.mobility, status: r.status,
        importantNotes: r.importantNotes, insuranceNo: r.insuranceNo, primaryNurseId: r.primaryNurseId,
      },
    }
  }

  return (
    <>
      <div className="sec-head">
        <h2 className="sec">{t('residents.history.master')}</h2>
        {editProps && <EditMaster residentId={r.id} {...editProps} />}
      </div>
      <div className="card card-body">
        <dl className="kv">
          <dt>{t('residents.form.status')}</dt><dd><span className={'tag ' + (r.status === 'active' ? 'ok' : r.status === 'absent' ? 'accent' : '')}>{t('residents.status.' + r.status)}</span></dd>
          <dt>{t('residents.history.admitted')}</dt><dd className="mono">{fmtDate(r.admittedAt, locale)}</dd>
          {r.dischargedAt && <><dt>{t('residents.history.discharged')}</dt><dd className="mono">{fmtDate(r.dischargedAt, locale)}</dd></>}
          <dt>{t('residents.form.insuranceNo')}</dt><dd className="mono">{r.insuranceNo ?? '–'}</dd>
          <dt>{t('residents.form.sex')}</dt><dd>{r.sex ? t('residents.form.sex' + r.sex.toUpperCase()) : '–'}</dd>
        </dl>
      </div>

      {(canExport || canAnonymise) && (
        <>
          <div className="sec-head"><h2 className="sec">{t('residents.dataRights.title')}</h2></div>
          <div className="card card-body stack-sm">
            {r.anonymisedAt && <div><span className="tag outline">{t('residents.dataRights.anonymised', { date: fmtDate(r.anonymisedAt, locale) })}</span></div>}
            <div className="row-between">
              <p className="small muted" style={{ margin: 0, maxWidth: '70ch' }}>{t('residents.dataRights.exportHint')}</p>
              <div className="row">
                {canExport && <a className="btn sm" href={`/residents/${r.id}/export`} download>{t('residents.dataRights.export')}</a>}
                {canAnonymise && !r.anonymisedAt && (leaver ? (
                  <FormDialog
                    label={t('residents.dataRights.anonymise')}
                    buttonClass="btn sm danger"
                    title={t('residents.dataRights.anonymiseTitle')}
                    action={anonymiseResidentAction.bind(null, r.id)}
                    submit={t('residents.dataRights.anonymise')}
                    submitClass="btn danger"
                    confirm="residents.dataRights.anonymiseConfirm"
                    success="residents.dataRights.done"
                  >
                    <div className="stack-sm">
                      <p className="small" style={{ margin: 0 }}><strong>{r.lastName} {r.firstName}</strong></p>
                      <p className="fg2" style={{ margin: 0 }}>{t('residents.dataRights.anonymiseText')}</p>
                      <label className="check"><input type="checkbox" name="confirm" /><span>{t('residents.dataRights.anonymiseCheck')}</span></label>
                    </div>
                  </FormDialog>
                ) : <span className="small muted">{t('residents.dataRights.onlyLeavers')}</span>)}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="sec-head">
        <h2 className="sec">{t('residents.history.title')}</h2>
        <div className="row">
          <span className="small muted">{t('residents.history.hint')}</span>
          <Link className="chip" href={`/residents/${r.id}/history${withViews ? '' : '?views=1'}`} aria-current={withViews ? 'page' : undefined} scroll={false}>{t('residents.history.showViews')}</Link>
        </div>
      </div>
      {logs.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead><tr><th>{t('residents.history.time')}</th><th>{t('residents.history.user')}</th><th>{t('residents.history.action')}</th><th>{t('residents.history.change')}</th></tr></thead>
            <tbody>
              {logs.map((l) => {
                const d = diff(l.before, l.after)
                return (
                  <tr key={String(l.id)}>
                    <td className="num small nowrap">{fmtDate(l.at, locale)} {hm(l.at)}</td>
                    <td className="small nowrap">{l.userId ? names.get(l.userId)?.short ?? '–' : t('residents.history.system')}</td>
                    <td className="small"><span className="nowrap">{actionLabel(l.action)}</span></td>
                    <td className="small" style={{ minWidth: 260 }}>
                      {d.length ? (
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {d.slice(0, 6).map((x) => (
                            <li key={x.k}>
                              <span className="muted">{fieldLabel(x.k)}:</span>{' '}
                              {x.from != null && <><span style={{ textDecoration: 'line-through', color: 'var(--fg-3)' }}>{x.from}</span> → </>}
                              <span>{x.to ?? '–'}</span>
                            </li>
                          ))}
                          {d.length > 6 && <li className="muted">{t('common.notifications.more', { n: d.length - 6 })}</li>}
                        </ul>
                      ) : <span className="muted">–</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">{t('residents.history.none')}</p>}
    </>
  )
}
