'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setUnitAction } from '@/app/(app)/shell-actions'

/** Bereich wählen und dessen Stationsansicht öffnen (Leitungsübersicht → Station). */
export function UnitOpen({ unitId, label, aria, current }: { unitId: string; label: string; aria: string; current: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button type="button" className="btn sm" aria-label={aria} disabled={pending} data-loading={pending || undefined}
      onClick={() => start(async () => {
        if (!current) await setUnitAction(unitId)
        router.push('/?view=care')
      })}>
      {label}
    </button>
  )
}
