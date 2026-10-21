'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/client'
import { INTL_LOCALE } from '@/i18n/core'

export function Clock() {
  const locale = useLocale()
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  if (!now) return <div className="clock mono" aria-hidden="true">&nbsp;</div>
  const d = new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now).replace(',', '')
  const t = new Intl.DateTimeFormat(INTL_LOCALE[locale], { hour: '2-digit', minute: '2-digit' }).format(now)
  return <time className="clock mono" dateTime={now.toISOString()}>{d} · {t}</time>
}
