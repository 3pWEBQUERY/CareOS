import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { LOCKED_IN_APP, NOTIFY_CATEGORIES, normalizePrefs } from '@/lib/notify-prefs'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { Checkbox, Switch } from '@/components/ui/fields'
import { saveNotificationPrefsAction } from './notification-actions'

/** Profil: Abschnitt «Benachrichtigungen» – Einstellungen je Art (PRD §25). Dienstbewusste Zustellung: src/lib/notify.ts. */
export async function NotificationSection() {
  const ctx = await getCtx()
  const { t, user } = ctx
  const row = await db.user.findUnique({ where: { id: user.id }, select: { notificationPrefs: true } })
  const prefs = normalizePrefs(row?.notificationPrefs)
  // Sicherheitsalarme nur für Personen mit Zugriff auf das Audit-Protokoll
  const cats = NOTIFY_CATEGORIES.filter((c) => c !== 'security' || ctx.can('admin.audit'))
  return (
    <section className="card" aria-labelledby="p-notify" id="p-notify">
      <div className="card-head"><h2 id="p-notify">{t('platform.notifications.title')}</h2></div>
      <div className="card-body">
        <ActionForm action={saveNotificationPrefsAction} success="platform.notifications.saved" reset={false}>
          <p className="small fg2" style={{ margin: 0 }}>{t('platform.notifications.hint')}</p>
          <div className="tablewrap">
            <table className="stable">
              <thead>
                <tr><th>{t('platform.notifications.col.kind')}</th><th style={{ textAlign: 'center' }}>{t('platform.notifications.col.app')}</th><th style={{ textAlign: 'center' }}>{t('platform.notifications.col.push')}</th></tr>
              </thead>
              <tbody>
                {cats.map((c) => {
                  const kind = t('platform.notifications.categories.' + c)
                  const locked = LOCKED_IN_APP.includes(c)
                  return (
                    <tr key={c}>
                      <th scope="row" style={{ fontWeight: 400 }}>
                        <div>{kind}</div>
                        <div className="small muted">{t('platform.notifications.categoryHints.' + c)}</div>
                      </th>
                      <td style={{ textAlign: 'center' }}>
                        {locked
                          ? <span className="small muted">{t('platform.notifications.locked')}</span>
                          : <Checkbox name={'app.' + c} defaultChecked={prefs.kinds[c].app} aria-label={t('platform.notifications.appFor', { kind })} />}
                      </td>
                      <td style={{ textAlign: 'center' }}><Checkbox name={'push.' + c} defaultChecked={prefs.kinds[c].push} aria-label={t('platform.notifications.pushFor', { kind })} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Switch name="quietOffDuty" defaultChecked={prefs.quietOffDuty} label={t('platform.notifications.quietOffDuty')} hint={t('platform.notifications.quietHint')} />
          <div className="form-actions"><span className="spacer" /><Submit>{t('platform.notifications.save')}</Submit></div>
        </ActionForm>
      </div>
    </section>
  )
}
