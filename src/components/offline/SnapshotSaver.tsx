'use client'

import { useEffect } from 'react'
import { offlineSupported } from '@/lib/offline/client'
import { saveSnapshot } from '@/lib/offline/store'
import type { ShiftSnapshot } from '@/lib/offline/types'

/** Speichert den minimalen Lesestand der Schicht verschlüsselt auf dem Gerät (PRD §39). */
export function SnapshotSaver({ data }: { data: Omit<ShiftSnapshot, 'savedAt' | 'theme'> }) {
  const key = JSON.stringify(data)
  useEffect(() => {
    if (!offlineSupported() || !navigator.onLine) return
    const snap: ShiftSnapshot = { ...(JSON.parse(key) as typeof data), savedAt: new Date().toISOString(), theme: document.documentElement.dataset.theme }
    void saveSnapshot(snap).catch(() => {})
  }, [key])
  return null
}
