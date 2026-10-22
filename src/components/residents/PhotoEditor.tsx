'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Checkbox, FileField, SegmentedControl } from '@/components/ui/fields'
import { removeResidentPhoto, setResidentPhoto } from '@/app/(app)/residents/[id]/photo/actions'
import { ResidentPhoto } from './ResidentPhoto'
import { CameraCapture } from './CameraCapture'

const isKey = (s: string) => /^[a-z]+\.[\w.]+$/.test(s)

/**
 * Bewohnerfoto im Banner (PRD §32): Anzeige für alle; mit Berechtigung öffnet ein Klick die Aufnahme.
 * Aufnahme mit kontrollierter Kamera (keine Kopie in der Gerätegalerie), alternativ Bilddatei; Einwilligung Pflicht.
 * Ohne eingerichtete Dateiablage erklärt der Dialog den Grund statt einer fehlschlagenden Aufnahme.
 */
export function PhotoEditor({ residentId, photoId, name, who, canEdit, storage }: {
  residentId: string
  photoId: string | null
  name: string
  who: string
  canEdit: boolean
  storage: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<'camera' | 'file'>('camera')
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [err, setErr] = useState<{ msg: string; field?: string } | null>(null)
  const [pending, start] = useTransition()
  const [ask, confirmDialog] = useConfirm()
  const photo = <ResidentPhoto residentId={residentId} photoId={photoId} name={name} size="lg" />
  if (!canEdit) return photo

  const close = () => { setOpen(false); setFile(null); setConsent(false); setErr(null); setSource('camera') }
  const save = () => {
    if (!file) return setErr({ msg: t('residents.photo.errors.empty') })
    if (!consent) return setErr({ msg: t('residents.photo.errors.consent'), field: 'consent' })
    const f = new FormData()
    f.set('photo', file)
    f.set('consent', 'on')
    f.set('source', source)
    start(async () => {
      const r = await setResidentPhoto(residentId, f)
      if (!r.ok) return setErr({ msg: isKey(r.error) ? t(r.error) : r.error, field: r.field })
      toast(t(r.message ?? 'residents.photo.saved'))
      close()
    })
  }
  const remove = async () => {
    if (!(await ask({ title: t('residents.photo.removeConfirm'), text: t('residents.photo.removeText'), context: <strong>{who}</strong>, confirmLabel: t('residents.photo.remove'), danger: true }))) return
    start(async () => {
      const r = await removeResidentPhoto(residentId)
      if (!r.ok) return toast(isKey(r.error) ? t(r.error) : r.error, { kind: 'crit' })
      toast(t(r.message ?? 'residents.photo.removed'))
      close()
    })
  }

  return (
    <>
      <button type="button" className="rphoto-btn" onClick={() => setOpen(true)} aria-label={t(photoId ? 'residents.photo.change' : 'residents.photo.add', { name })} title={t(photoId ? 'residents.photo.change' : 'residents.photo.add', { name })}>
        {photo}
        {!photoId && <span className="rphoto-add" aria-hidden="true">+</span>}
      </button>
      {open && (
        <Dialog
          open
          onClose={close}
          title={t(photoId ? 'residents.photo.titleChange' : 'residents.photo.titleAdd')}
          context={<strong>{who}</strong>}
          footer={storage ? (
            <>
              {photoId && <button type="button" className="btn danger" onClick={remove} disabled={pending} style={{ marginRight: 'auto' }}>{t('residents.photo.remove')}</button>}
              <button type="button" className="btn" onClick={close} disabled={pending}>{t('common.cancel')}</button>
              <button type="button" className="btn primary" onClick={save} disabled={pending || !file} data-loading={pending || undefined}>{t('residents.photo.save')}</button>
            </>
          ) : <button type="button" className="btn" onClick={close}>{t('common.close')}</button>}
        >
          {!storage ? (
            <div className="alert warn" role="status"><span className="grow">{t('residents.photo.noStorage')}</span></div>
          ) : (
            <>
              <SegmentedControl
                aria-label={t('residents.photo.source')}
                value={source}
                onChange={(v) => { setSource(v as 'camera' | 'file'); setFile(null); setErr(null) }}
                options={[{ value: 'camera', label: t('residents.photo.sourceCamera') }, { value: 'file', label: t('residents.photo.sourceFile') }]}
              />
              {source === 'camera'
                ? <CameraCapture square maxSize={800} onCapture={(f) => { setFile(f); setErr(null) }} />
                : <FileField label={t('residents.photo.file')} accept="image/jpeg,image/png,image/webp" maxSize={5 * 1024 * 1024} onFiles={(fs) => { setFile(fs[0] ?? null); setErr(null) }} />}
              <p className="small muted" style={{ margin: 0 }}>{t('residents.photo.hint')}</p>
              <Checkbox
                checked={consent}
                onChange={(e) => { setConsent(e.target.checked); setErr(null) }}
                label={t('residents.photo.consent')}
                error={err?.field === 'consent' ? err.msg : undefined}
              />
              {err && err.field !== 'consent' && <p className="err" role="alert" style={{ margin: 0 }}>{err.msg}</p>}
            </>
          )}
        </Dialog>
      )}
      {confirmDialog}
    </>
  )
}
