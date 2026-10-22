'use client'

import { useEffect } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'

/** Hinweis, wenn der Service Worker eine neue App-Version übernommen hat. */
export function SwUpdateNotice() {
  const t = useT()
  useEffect(() => {
    const on = () => toast(t('common.pwa.updated'), { undo: () => location.reload(), undoLabel: t('common.pwa.reload'), ms: 15_000 })
    window.addEventListener('careos:sw-updated', on)
    return () => window.removeEventListener('careos:sw-updated', on)
  }, [t])
  return null
}
