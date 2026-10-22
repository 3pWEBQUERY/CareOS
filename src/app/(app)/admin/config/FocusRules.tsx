import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { FOCUS_LIMITS, focusRules } from '@/lib/focus-rules'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { NumberField, Select, Switch } from '@/components/ui/fields'
import { saveFocusRulesAction } from './focus-actions'

/**
 * Admin → Klinische Konfiguration → Fokusdokumentation (PRD §10.3): welche Veränderungen in der Akte einen
 * Dokumentationsvorschlag auslösen, mit welchem Formular und wie lange der Vorschlag offen bleibt.
 */
export async function FocusRules() {
  const ctx = await getCtx()
  const { t } = ctx
  const rules = focusRules(ctx.org.settings)
  const forms = await db.formDefinition.findMany({ where: { orgId: ctx.org.id, active: true }, select: { key: true, name: true }, orderBy: { name: 'asc' } })
  return (
    <ActionForm action={saveFocusRulesAction} reset={false}>
      <p className="fg2" style={{ margin: 0, maxWidth: '72ch' }}>{t('admin.config.focusDoc.hint')}</p>
      {rules.map((r) => {
        const missing = r.formKey != null && !forms.some((f) => f.key === r.formKey)
        const lim = r.key === 'pain' || r.key === 'taskSkipped' ? FOCUS_LIMITS.threshold[r.key] : null
        return (
          <section key={r.key} className="card" aria-labelledby={'fd-' + r.key}>
            <div className="card-head">
              <div>
                <h2 id={'fd-' + r.key}>{t(`admin.config.focusDoc.rules.${r.key}.name`)}</h2>
                <span className="small muted">{t(`admin.config.focusDoc.rules.${r.key}.hint`)}</span>
              </div>
              <Switch name={r.key + '.enabled'} defaultChecked={r.enabled} label={t('admin.config.focusDoc.enabled')} />
            </div>
            <div className="card-body stack-sm">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <Select label={t('admin.config.focusDoc.form')} name={r.key + '.formKey'} defaultValue={missing ? '' : r.formKey ?? ''} wrapStyle={{ minWidth: 240 }}
                  hint={missing ? t('admin.config.focusDoc.formMissing', { key: r.formKey ?? '' }) : undefined}>
                  <option value="">{t('admin.config.focusDoc.freeNote')}</option>
                  {forms.map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}
                </Select>
                {lim && r.threshold != null && (
                  <NumberField label={t(`admin.config.focusDoc.threshold.${r.key}`)} name={r.key + '.threshold'} min={lim.min} max={lim.max} step={1} defaultValue={r.threshold} required
                    unit={r.key === 'pain' ? 'NRS' : '×'} hint={`${lim.min}–${lim.max}`} wrapStyle={{ width: 220 }} />
                )}
                <NumberField label={t('admin.config.focusDoc.windowH')} name={r.key + '.windowH'} min={FOCUS_LIMITS.windowH.min} max={FOCUS_LIMITS.windowH.max} step={1} defaultValue={r.windowH} required
                  unit={t('admin.config.focusDoc.hours')} hint={`${FOCUS_LIMITS.windowH.min}–${FOCUS_LIMITS.windowH.max}`} wrapStyle={{ width: 200 }} />
              </div>
            </div>
          </section>
        )
      })}
      <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}
