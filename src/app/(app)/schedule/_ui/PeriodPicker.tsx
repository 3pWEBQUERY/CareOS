'use client'

import { useRouter } from 'next/navigation'
import { MonthPicker } from '@/components/ui/MonthPicker'

/** Monat/Jahr im Dienstplan wählen; Wochenansichten springen in die Woche mit dem Monatsersten. */
export function PeriodPicker({ view, month, weekBased }: { view: string; month: string; weekBased: boolean }) {
  const router = useRouter()
  return (
    <MonthPicker
      value={month}
      onChange={(m) => {
        const p = new URLSearchParams(view !== 'week' ? { view } : {})
        if (weekBased) {
          const [y, mo] = m.split('-').map(Number)
          const d = new Date(y, mo - 1, 1)
          d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
          p.set('w', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
        } else p.set('m', m)
        router.push('/schedule?' + p.toString())
      }}
    />
  )
}
