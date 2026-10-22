import { getCtx } from '@/lib/context'
import { WORKFLOW_LIMITS, WORKFLOW_RULES, workflowPolicy, type WorkflowRule } from '@/lib/workflow-rules'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { NumberField, Switch } from '@/components/ui/fields'
import { saveWorkflowsAction } from './workflow-actions'

const UNITS: Record<string, 'minutes' | 'days' | 'pct' | 'points'> = { afterMin: 'minutes', days: 'days', pct: 'pct', minReductionPct: 'pct', maxScore: 'points' }

/** Admin → Klinische Konfiguration → Smart Workflows (PRD §48): Regeln für Folgeaufgaben. */
export async function Workflows() {
  const ctx = await getCtx()
  const { t } = ctx
  const p = workflowPolicy(ctx.org.settings)
  const unit = (f: string) => {
    const u = UNITS[f]
    return u === 'minutes' ? t('common.minutes') : u === 'days' ? t('tasks.recur.unit.daily') : u === 'pct' ? '%' : t('tasks.rules.points')
  }
  const rule = (k: WorkflowRule) => {
    const cfg = p[k] as Record<string, number | boolean>
    return (
      <section key={k} className="card" aria-labelledby={'wf-' + k}>
        <div className="card-head">
          <div>
            <h2 id={'wf-' + k}>{t(`tasks.rules.${k}.name`)}</h2>
            <span className="small muted">{t('tasks.rules.creates', { task: t(`tasks.rules.${k}.task`) })}</span>
          </div>
          <Switch name={k + '.enabled'} defaultChecked={cfg.enabled as boolean} label={t('tasks.rules.enabled')} />
        </div>
        <div className="card-body stack-sm">
          <p className="small fg2" style={{ margin: 0, maxWidth: '72ch' }}>{t(`tasks.rules.${k}.hint`)}</p>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {(Object.entries(WORKFLOW_LIMITS[k]) as [string, { min: number; max: number }][]).map(([f, lim]) => (
              <NumberField key={f} label={t(`tasks.rules.${k}.${f}`)} name={`${k}.${f}`} min={lim.min} max={lim.max} step={1} defaultValue={cfg[f] as number} required
                unit={unit(f)} hint={`${lim.min}–${lim.max}`} wrapStyle={{ width: 200 }} />
            ))}
          </div>
        </div>
      </section>
    )
  }
  return (
    <ActionForm action={saveWorkflowsAction} reset={false}>
      <p className="fg2" style={{ margin: 0, maxWidth: '72ch' }}>{t('tasks.rules.hint')}</p>
      {WORKFLOW_RULES.map(rule)}
      <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}
