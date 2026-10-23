'use client'

import { useEffect, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { TEXT_COOKIE, TEXT_SIZES, type TextSize } from '@/lib/theme'
import { setTextSizeAction } from './actions'

const apply = (v: TextSize) => {
  document.documentElement.dataset.text = v
}

/**
 * Schriftgrösse im Kopf des Bewohnerportals: drei grosse Schaltflächen «A», sofort wirksam,
 * gespeichert am Konto (gilt nach der Anmeldung auf jedem Gerät).
 */
export function TextSizeControl({ value }: { value: TextSize }) {
  const t = useT()
  const [cur, setCur] = useState<TextSize>(value)
  const [, start] = useTransition()
  const pick = (v: TextSize) => {
    if (v === cur) return
    const prev = cur
    setCur(v)
    apply(v)
    start(async () => {
      const r = await setTextSizeAction(v)
      if (!r.ok) {
        setCur(prev)
        apply(prev)
        toast(t(r.error), { kind: 'crit' })
      }
    })
  }
  return (
    <div className="seg self-text" role="group" aria-label={t('residentPortal.text.label')}>
      {TEXT_SIZES.map((x) => (
        <button key={x} type="button" aria-pressed={cur === x} onClick={() => pick(x)} className={'self-text-' + x}>
          <span aria-hidden="true">A</span>
          <span className="sr-only">{t('residentPortal.text.' + x)}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Gleicht die Schriftgrösse des Geräts an das Konto an, falls sie anderswo geändert wurde
 * (Cookie der Wurzel-Schriftgrösse, src/app/layout.tsx).
 */
export function TextSizeSync({ value }: { value: TextSize }) {
  useEffect(() => {
    if (document.documentElement.dataset.text === value) return
    apply(value)
    document.cookie = `${TEXT_COOKIE}=${value}; path=/; max-age=${365 * 86400}; samesite=lax`
  }, [value])
  return null
}
