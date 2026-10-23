'use client'

import { usePathname } from 'next/navigation'
import { useT } from '@/i18n/client'
import { moduleOfPath } from '@/lib/modules'

/**
 * Seiten abgeschalteter Module (PRD §69): statt des Inhalts «Modul nicht aktiv». Wirkt bei jedem Seitenwechsel
 * (Pfad im Client); die Daten schützt zusätzlich getCtx(), das die Berechtigungen des Moduls entfernt.
 */
export function ModuleGate({ off, isAdmin, children }: { off: string[]; isAdmin: boolean; children: React.ReactNode }) {
  const path = usePathname()
  const t = useT()
  const mod = off.length ? moduleOfPath(path) : null
  if (!mod || !off.includes(mod)) return <>{children}</>
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head"><h1>{t('tenancy.modules.offTitle')}</h1></div>
      <div className="tabpanel">
        <div className="alert warn" role="status">
          <span className="grow">
            {t('tenancy.modules.offText', { name: t('tenancy.modules.items.' + mod + '.name') })}{' '}
            {isAdmin ? <a href="/admin/config?tab=features">{t('tenancy.modules.offAdmin')}</a> : t('tenancy.modules.offContact')}
          </span>
        </div>
      </div>
    </main>
  )
}
