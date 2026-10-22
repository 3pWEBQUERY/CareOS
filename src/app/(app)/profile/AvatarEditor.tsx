'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Avatar } from '@/components/people/Avatar'
import { FileField } from '@/components/ui/fields'
import { removeAvatarAction, uploadAvatarAction } from './actions'

const SIZE = 320
const TYPES = 'image/jpeg,image/png,image/webp'

/**
 * Verkleinert und beschneidet das Bild im Browser auf ein Quadrat (320 px, JPEG). Das Neu-Kodieren über
 * Canvas entfernt EXIF-Daten (GPS-Standort, Kamera) – sie gelangen nie auf den Server.
 */
async function squareJpeg(file: File): Promise<File> {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const g = canvas.getContext('2d')
  if (!g) throw new Error('canvas')
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
  bmp.close()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.86))
  if (!blob) throw new Error('encode')
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
}

export function AvatarEditor({ src, initials }: { src: string | null; initials: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  const tr = (k: string) => (/^[a-z]+\.[\w.]+$/.test(k) ? t(k) : k)

  const upload = (files: File[]) => {
    const f = files[0]
    if (!f) return
    setError(null)
    start(async () => {
      let small: File
      try {
        small = await squareJpeg(f)
      } catch {
        setError(t('people.me.errors.photoType'))
        return
      }
      const fd = new FormData()
      fd.set('photo', small)
      const r = await uploadAvatarAction(fd)
      setKey((k) => k + 1) // Auswahl zurücksetzen
      if (r.ok) toast(tr(r.message ?? 'people.me.photoSaved'))
      else setError(tr(r.error))
    })
  }

  const remove = () =>
    start(async () => {
      const r = await removeAvatarAction()
      if (r.ok) toast(tr(r.message ?? 'people.me.photoRemoved'))
      else toast(tr(r.error), { kind: 'crit' })
    })

  return (
    <div className="ppl-avatar-edit" data-loading={pending || undefined}>
      <Avatar src={src} initials={initials} size="xl" />
      <div className="stack-sm grow" style={{ minWidth: 0 }}>
        <FileField key={key} label={t('people.me.photo')} hint={t('people.me.photoHint')} name="photo" accept={TYPES} maxSize={5 * 1024 * 1024} preview={false} typesLabel="JPG, PNG, WebP" onFiles={upload} disabled={pending} error={error} />
        {src && <div><button type="button" className="btn sm ghost" onClick={remove} disabled={pending}>{t('people.me.photoRemove')}</button></div>}
      </div>
    </div>
  )
}
