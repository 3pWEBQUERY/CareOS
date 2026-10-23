'use client'

import { useTransition } from 'react'
import { Select } from '@/components/ui/fields'
import { selectResidentAction } from './actions'

/** Auswahl der Person bei mehreren Zugängen (z. B. beide Eltern im selben Haus). */
export function ResidentSwitch({ value, label, options }: { value: string; label: string; options: { value: string; label: string }[] }) {
  const [pending, start] = useTransition()
  return (
    <Select aria-label={label} value={value} loading={pending} className="portal-switch" onChange={(e) => start(async () => { await selectResidentAction(e.target.value) })}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  )
}
