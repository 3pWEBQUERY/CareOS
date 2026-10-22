import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { pushConfigured } from '@/lib/env'
import { PushSettings } from './PushSettings'

/** Profil: Abschnitt «Push-Benachrichtigungen» (Server-Teil). */
export async function PushSection() {
  const ctx = await getCtx()
  const { t, user } = ctx
  const devices = await db.pushSubscription.count({ where: { userId: user.id } })
  return (
    <section className="card" aria-labelledby="p-push">
      <div className="card-head"><h2 id="p-push">{t('profile.push.title')}</h2></div>
      <div className="card-body">
        <PushSettings configured={pushConfigured()} priorities={user.pushPriorities} devices={devices} />
      </div>
    </section>
  )
}
