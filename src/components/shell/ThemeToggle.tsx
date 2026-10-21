'use client'

import { useEffect, useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { setThemeAction } from '@/app/(app)/shell-actions'
import { IconMoon, IconSun } from '@/components/icons'

/** Umschalter Hell/Dunkel. Wirkt sofort, wird im Profil gespeichert. */
export function ThemeToggle() {
  const t = useT()
  const [, start] = useTransition()
  const [dark, setDark] = useState(false)
  useEffect(() => {
    setDark(isDark())
    // Auch Änderungen aus dem Profil (oder der Systemeinstellung) sofort übernehmen.
    const mo = new MutationObserver(() => setDark(isDark()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onMq = () => setDark(isDark())
    mq.addEventListener('change', onMq)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', onMq)
    }
  }, [])
  function isDark() {
    const v = document.documentElement.dataset.theme
    return v === 'dark' || (v === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  }
  function toggle() {
    const next = isDark() ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    setDark(next === 'dark')
    start(() => setThemeAction(next))
  }
  const label = dark ? t('common.theme.toggleToLight') : t('common.theme.toggleToDark')
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={label} title={label}>
      {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </button>
  )
}
