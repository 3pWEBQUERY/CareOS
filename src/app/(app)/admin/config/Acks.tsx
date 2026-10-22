import { getCtx } from '@/lib/context'
import { ACK_KEYS, ackSettings } from '@/lib/acks'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { saveAckSettingsAction } from './acks-actions'

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
            <label className="li" style={{ cursor: 'pointer', alignItems: 'center' }}>
              <input type="checkbox" name={k} defaultChecked={s[k]} style={{ width: 18, height: 18, accentColor: 'var(--accent)', flex: 'none' }} />
              <div className="grow"><div>{t('admin.acks.' + k)}</div><div className="small muted">{t('admin.acks.' + k + 'Hint')}</div></div>
            </label>
          </li>
        ))}
      </ul>
      <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
    </ActionForm>
  )
}
