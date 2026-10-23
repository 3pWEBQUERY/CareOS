'use client'

import { useOptimistic, useTransition } from 'react'
import { setUnitAction } from '@/app/(app)/shell-actions'
import { Select } from '@/components/ui/fields'

/**
 * Bereichswahl (Wohngruppe/Station) als «Standort · Wohngruppe». In der Topbar randlos, auf «Mehr»
 * (Mobile/Tablet) als Feld mit Label. Während des Wechsels zeigt das Feld den neuen Bereich mit Spinner.
 */
export function UnitSwitcher({ units, current, label, field }: { units: { id: string; name: string; location: string }[]; current: string | null; label: string; field?: boolean }) {
  const [pending, start] = useTransition()
  const [shown, setShown] = useOptimistic(current ?? '')
  if (units.length <= 1) {
    const u = units[0]
    return <strong>{u ? `${u.location} · ${u.name}` : '–'}</strong>
  }
  const cur = units.find((u) => u.id === shown)
  return (
    <Select
      plain={!field}
      label={field ? label : undefined}
      aria-label={field ? undefined : label}
      title={!field && cur ? `${cur.location} · ${cur.name}` : undefined}
      value={shown}
      loading={pending}
      onChange={(e) => {
        const v = e.target.value
        start(async () => {
          setShown(v)
          await setUnitAction(v)
        })
      }}
    >
      {units.map((u) => (
        <option key={u.id} value={u.id}>{u.location} · {u.name}</option>
      ))}
    </Select>
  )
}
