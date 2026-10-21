'use client'

import { useTransition } from 'react'
import { setUnitAction } from '@/app/(app)/shell-actions'

export function UnitSwitcher({ units, current, label }: { units: { id: string; name: string; location: string }[]; current: string | null; label: string }) {
  const [pending, start] = useTransition()
  if (units.length <= 1) {
    const u = units[0]
    return <strong>{u ? `${u.location} · ${u.name}` : '–'}</strong>
  }
  return (
    <select aria-label={label} value={current ?? ''} disabled={pending} onChange={(e) => start(() => setUnitAction(e.target.value))}>
      {units.map((u) => (
        <option key={u.id} value={u.id}>{u.location} · {u.name}</option>
      ))}
    </select>
  )
}
