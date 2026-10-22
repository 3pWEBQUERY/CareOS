'use client'

import { useTransition } from 'react'
import { setUnitAction } from '@/app/(app)/shell-actions'

/** Bereichswahl (Wohngruppe/Station). In der Topbar ohne Rahmen, auf «Mehr» (Mobile/Tablet) als Feld. */
export function UnitSwitcher({ units, current, label, className, id }: { units: { id: string; name: string; location: string }[]; current: string | null; label: string; className?: string; id?: string }) {
  const [pending, start] = useTransition()
  if (units.length <= 1) {
    const u = units[0]
    return <strong>{u ? `${u.location} · ${u.name}` : '–'}</strong>
  }
  const cur = units.find((u) => u.id === current)
  return (
    <select id={id} className={className} aria-label={id ? undefined : label} title={cur ? `${cur.location} · ${cur.name}` : undefined} value={current ?? ''} disabled={pending} aria-busy={pending || undefined} onChange={(e) => start(() => setUnitAction(e.target.value))}>
      {units.map((u) => (
        <option key={u.id} value={u.id}>{u.location} · {u.name}</option>
      ))}
    </select>
  )
}
