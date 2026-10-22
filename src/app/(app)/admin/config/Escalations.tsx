import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate, hm } from '@/lib/time'
import { ESCALATION_LIMITS, escalationPolicy } from '@/lib/escalation-policy'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { saveEscalationAction } from './escalation-actions'

/** Admin → Klinische Konfiguration → Eskalationen (PRD §45 Workflow). */
export async function Escalations() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  const [roles, last] = await Promise.all([
    db.role.findMany({ where: { orgId: ctx.org.id }, select: { key: true, name: true }, orderBy: { name: 'asc' } }),
    db.jobRun.findFirst({ where: { name: 'escalations', ok: true }, orderBy: { startedAt: 'desc' } }),
  ])
  const p = escalationPolicy(ctx.org.settings)
  const sum = (last?.summary ?? {}) as Record<string, number>

  const minutes = (name: keyof typeof ESCALATION_LIMITS, label: string) => {
    const lim = ESCALATION_LIMITS[name]
    return (
      <label className="fld">
        <span className="lbl">{label}</span>
        <input className="field mono" type="number" name={name} min={lim.min} max={lim.max} step={1} defaultValue={p[name]} required style={{ maxWidth: 140 }} />
        <span className="hint">{t('admin.escalation.range', { min: lim.min, max: lim.max })}</span>
      </label>
    )
  }
  const rolePicker = (name: 'taskNotifyRoles' | 'vitalsAbnormalNotifyRoles' | 'incidentSevereNotifyRoles', label: string) => (
    <fieldset className="fld span-all" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="lbl" style={{ padding: 0, marginBottom: 4 }}>{label}</legend>
      <div className="row" style={{ gap: '4px 16px' }}>
        {roles.map((r) => (
          <label key={r.key} className="check">
            <input type="checkbox" name={name} value={r.key} defaultChecked={p[name].includes(r.key)} />
            <span>{r.name}</span>
          </label>
        ))}
      </div>
      {!p[name].length && <span className="hint">{t('admin.escalation.noRoles')}</span>}
    </fieldset>
  )

  return (
    <ActionForm action={saveEscalationAction} reset={false} success="common.saved">
      <div className="row-between">
        <p className="fg2" style={{ margin: 0, maxWidth: '72ch' }}>{t('admin.escalation.hint')}</p>
        <span className="small muted">
          {last ? (
            <>
              {t('admin.escalation.lastRun', { at: `${fmtDate(last.startedAt, locale)} ${hm(last.startedAt)}` })}
              {' · '}
              {t('admin.escalation.lastResult', { tasks: sum.tasks ?? 0, handovers: sum.handovers ?? 0, notified: sum.notified ?? 0 })}
            </>
          ) : t('admin.escalation.neverRun')}
        </span>
      </div>
      <label className="check">
        <input type="checkbox" name="enabled" defaultChecked={p.enabled} />
        <span>{t('admin.escalation.enabled')}</span>
      </label>

      <section className="card" aria-labelledby="esc-tasks">
        <div className="card-head"><h2 id="esc-tasks">{t('admin.escalation.tasks')}</h2></div>
        <div className="card-body form-grid">
          {minutes('taskOverdueMinutes', t('admin.escalation.taskOverdue'))}
          {minutes('criticalTaskOverdueMinutes', t('admin.escalation.criticalOverdue'))}
          {rolePicker('taskNotifyRoles', t('admin.escalation.taskRoles'))}
        </div>
      </section>

      <section className="card" aria-labelledby="esc-ho">
        <div className="card-head"><h2 id="esc-ho">{t('admin.escalation.handover')}</h2></div>
        <div className="card-body form-grid">
          {minutes('unackedImportantHandoverMinutes', t('admin.escalation.handoverMinutes'))}
        </div>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="esc-vitals">
          <div className="card-head"><h2 id="esc-vitals">{t('admin.escalation.vitals')}</h2></div>
          <div className="card-body form-grid">{rolePicker('vitalsAbnormalNotifyRoles', t('admin.escalation.vitalsRoles'))}</div>
        </section>
        <section className="card" aria-labelledby="esc-inc">
          <div className="card-head"><h2 id="esc-inc">{t('admin.escalation.incidents')}</h2></div>
          <div className="card-body form-grid">{rolePicker('incidentSevereNotifyRoles', t('admin.escalation.incidentRoles'))}</div>
        </section>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('admin.escalation.rolesHint')}</p>
      <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}
