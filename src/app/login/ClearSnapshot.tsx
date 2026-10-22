'use client'

import { useEffect } from 'react'
import { clearSnapshot } from '@/lib/offline/store'

/** Auf der Login-Seite den Offline-Lesestand der zuletzt angemeldeten Person entfernen. */
export function ClearSnapshot() {
  useEffect(() => {
    void clearSnapshot()
  }, [])
  return null
}
