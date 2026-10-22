import { getCtx } from '@/lib/context'
import { ACK_KEYS, ackSettings } from '@/lib/acks'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { saveAckSettingsAction } from './acks-actions'
import { Switch } from '@/components/ui/fields'

/** Bestätigungen (PRD §45 Workflow): wann eine Kenntnisnahme verlangt wird. */
export async function Acks() {
  const ctx = await getCtx()
  const { t } = ctx
  const s = ackSettings(ctx.org.settings)
  return (
    <ActionForm action={saveAckSettingsAction} reset={false} success="common.saved">
      <p className="fg2" style={{ margin: 0, maxWidth: '80ch' }}>{t('admin.acks.hint')}</p>
      <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
        {ACK_KEYS.map((k) => (
          <li key={k}>
            <div className="li">
              <Switch name={k} defaultChecked={s[k]} label={t('admin.acks.' + k)} hint={t('admin.acks.' + k + 'Hint')} />
            </div>
          </li>
        ))}
      </ul>
      <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}
