'use client'

import { useT } from '@/i18n/client'
import { NotFoundState } from '@/components/ui/ErrorState'

/** Akte nicht gefunden oder ausserhalb des Zugriffsbereichs: Liste bleibt sichtbar. */
export default function ResidentNotFound() {
  const t = useT()
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="scroll">
        <div className="tabpanel"><NotFoundState compact backHref="/residents" backLabel={t('common.notFoundPage.backResidents')} /></div>
      </div>
    </main>
  )
}
