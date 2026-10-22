'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'

/**
 * Bewohnerfoto zur Identifikation (PRD §32, §13.2): in Banner, Medikamentenrunde und kritischen Dialogen.
 * Auslieferung über /residents/[id]/photo (Berechtigung im Bereich der Person, kurzlebige Bucket-URL).
 * Ohne Foto oder wenn die Ablage nicht erreichbar ist: Initialen mit gestricheltem Rand («kein Foto»), damit
 * nie ein leeres Bild als Identifikation erscheint.
 */
export function ResidentPhoto({ residentId, photoId, name, size = 'md', className }: {
  residentId: string
  photoId: string | null | undefined
  /** «Nachname Vorname» – für Alternativtext und Initialen */
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const t = useT()
  const [failed, setFailed] = useState<string | null>(null)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('')
  const cls = 'rphoto rphoto-' + size + (className ? ' ' + className : '')
  if (!photoId || failed === photoId) {
    return (
      <span className={cls + ' is-empty'} title={t(failed ? 'residents.photo.unavailable' : 'residents.photo.none')} aria-hidden="true">
        {initials}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={cls}
      src={`/residents/${residentId}/photo?v=${photoId}`}
      alt={t('residents.photo.alt', { name })}
      decoding="async"
      onError={() => setFailed(photoId)}
    />
  )
}
