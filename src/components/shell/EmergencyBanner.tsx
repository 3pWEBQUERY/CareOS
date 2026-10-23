'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'

/** Banner während eines Notfallzugriffs (PRD §34/§37): nur lesen, Restzeit, vorzeitig beenden. */
export function EmergencyBanner({ until, minutes, end }: { until: string; minutes: number; end: () => Promise<{ ok: boolean; error?: string }> }) {
  const t = useT()
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div className="alert crit emergency-banner" role="status">
      <span className="grow"><strong className="em-title">{t('tenancy.emergency.activeTitle')}</strong> {t('tenancy.emergency.activeUntil', { time: until, n: minutes })}</span>
      <button
        type="button"
        className="btn sm"
        data-loading={pending}
        disabled={pending}
        onClick={() => start(async () => {
          const r = await end()
          if (r.ok) { toast(t('tenancy.emergency.ended')); router.refresh() } else toast(t(r.error ?? 'common.genericError'), { kind: 'crit' })
        })}
      >
        {t('tenancy.emergency.end')}
      </button>
    </div>
  )
}
