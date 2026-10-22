'use client'

import { useState } from 'react'

/**
 * Profilbild mit Initialen als Ersatz (PRD §55). Bild über /api/files/[id] (Berechtigungsprüfung);
 * fehlt es oder lädt es nicht, erscheinen die Initialen. Dekorativ: Name steht immer daneben (alt="").
 */
export function Avatar({ src, initials, size = 'md', className }: { src: string | null; initials: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  const [failed, setFailed] = useState(false)
  const cls = ['pav', 'pav-' + size, className].filter(Boolean).join(' ')
  if (src && !failed)
    // eslint-disable-next-line @next/next/no-img-element -- geschützte Datei hinter Redirect, kein Bild-Optimizer
    return <img className={cls} src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setFailed(true)} />
  return <span className={cls} aria-hidden="true">{initials}</span>
}
