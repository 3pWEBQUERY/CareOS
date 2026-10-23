import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { fmtDate, fmtRel } from '@/lib/time'
import { ActBtn, SecretForm } from '@/components/admin/ui'
import { createCalendarTokenAction, revokeCalendarTokenAction } from './calendar-actions'

/** Profil: «Kalender abonnieren» – eigene Dienste als iCal-Abo (PRD §19). */
export async function CalendarSection() {
  const ctx = await getCtx()
  const { t, user, locale } = ctx
  if (!ctx.hasModule('schedule')) return null
  const active = await db.calendarToken.findFirst({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: 'desc' } })
  const now = new Date()
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
  return (
    <section className="card" aria-labelledby="p-cal">
      <div className="card-head">
        <h2 id="p-cal">{t('profile.calendar.title')}</h2>
        {active ? <span className="tag ok">{t('profile.calendar.active')}</span> : <span className="tag outline">{t('profile.calendar.inactive')}</span>}
      </div>
      <div className="card-body stack-sm">
        <p className="fg2" style={{ margin: 0, maxWidth: '72ch' }}>{t('profile.calendar.hint')}</p>
        {active ? (
          <p className="small muted" style={{ margin: 0 }}>
            {t('profile.calendar.since', { date: fmtDate(active.createdAt, locale) })} · {active.lastUsedAt ? t('profile.calendar.lastUsed', { when: rel(active.lastUsedAt) }) : t('profile.calendar.neverUsed')}
          </p>
        ) : null}
        <SecretForm action={createCalendarTokenAction} submit={t(active ? 'profile.calendar.regenerate' : 'profile.calendar.subscribe')} submitClass={active ? 'btn' : 'btn primary'} intro={t('profile.calendar.once')} label={t('profile.calendar.url')}>
          {active ? <p className="small muted" style={{ margin: 0 }}>{t('profile.calendar.regenerateHint')}</p> : null}
        </SecretForm>
        {active ? <div><ActBtn action={revokeCalendarTokenAction} className="btn sm danger" confirm="profile.calendar.revokeConfirm">{t('profile.calendar.revoke')}</ActBtn></div> : null}
      </div>
    </section>
  )
}
