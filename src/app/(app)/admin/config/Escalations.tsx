import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate, hm } from '@/lib/time'
import { ESCALATION_LIMITS, VISIT_QUESTION_HOURS, escalationPolicy } from '@/lib/escalation-policy'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { saveEscalationAction } from './escalation-actions'
import { Checkbox, NumberField, Switch } from '@/components/ui/fields'

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
      <NumberField label={label} name={name} min={lim.min} max={lim.max} step={1} defaultValue={p[name]} required unit={t('common.minutes')}
        hint={t('admin.escalation.range', { min: lim.min, max: lim.max })} wrapStyle={{ maxWidth: 220 }} />
    )
  }
  const rolePicker = (name: 'taskNotifyRoles' | 'vitalsAbnormalNotifyRoles' | 'incidentSevereNotifyRoles', label: string) => (
    <fieldset className="fld span-all" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="lbl" style={{ padding: 0, marginBottom: 4 }}>{label}</legend>
      <div className="row" style={{ gap: '4px 16px' }}>
        {roles.map((r) => (
          <Checkbox key={r.key} name={name} value={r.key} defaultChecked={p[name].includes(r.key)} label={r.name} />
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
      <Switch name="enabled" defaultChecked={p.enabled} label={t('admin.escalation.enabled')} />

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

      {ctx.hasModule('visit') && (
        <section className="card" aria-labelledby="esc-visit">
          <div className="card-head"><h2 id="esc-visit">{t('admin.escalation.visit')}</h2></div>
          <div className="card-body form-grid">
            <NumberField label={t('admin.escalation.visitHours')} name="visitQuestionHours" min={VISIT_QUESTION_HOURS.min} max={VISIT_QUESTION_HOURS.max} step={1} defaultValue={p.visitQuestionHours} required unit={t('admin.escalation.hours')}
              hint={t('admin.escalation.visitHint', { min: VISIT_QUESTION_HOURS.min, max: VISIT_QUESTION_HOURS.max })} wrapStyle={{ maxWidth: 260 }} />
          </div>
        </section>
      )}

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
