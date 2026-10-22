'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { useConfirm, splitQuestion } from '@/components/ui/ConfirmDialog'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { EDGE, EXUDATE, TISSUE, WOUND_KINDS, WOUND_ORIGINS } from '@/lib/care'
import { createWoundAction, saveWoundEntryAction, setWoundStatusAction } from './actions'
import { DateField } from '@/components/ui/DateField'
import { DateTimeField } from '@/components/ui/DateTimeField'

export function NewWoundButton({ residentId, today, contextLabel }: { residentId: string; today: string; contextLabel: string }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const sites = t('care.wounds.sitesList').split(',')
  const classes = t('care.wounds.classesList').split(',')
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>{t('care.wounds.newWound')}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('care.wounds.newWound')} context={contextLabel}>
        <ActionForm
          action={(f) => createWoundAction(residentId, f)}
          onDone={(r) => {
            if (!r.ok) return
            setOpen(false)
            const id = (r.data as { id?: string } | undefined)?.id
            if (id) router.push(`/residents/${residentId}/wounds/${id}`)
          }}
        >
          <div className="form-grid">
            <label className="fld" htmlFor="w-site">
              <span className="lbl">{t('care.wounds.bodySite')}</span>
              <input id="w-site" name="bodySite" className="field" list="w-sites" maxLength={120} autoComplete="off" required />
              <datalist id="w-sites">{sites.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
            <label className="fld" htmlFor="w-kind">
              <span className="lbl">{t('care.wounds.kind')}</span>
              <select id="w-kind" name="kind" className="field" defaultValue="pressure">
                {WOUND_KINDS.map((k) => <option key={k} value={k}>{t('care.wounds.kinds.' + k)}</option>)}
              </select>
            </label>
            <label className="fld" htmlFor="w-class">
              <span className="lbl">{t('care.wounds.classification')} <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>({t('common.optional')})</span></span>
              <input id="w-class" name="classification" className="field" list="w-classes" maxLength={120} autoComplete="off" />
              <datalist id="w-classes">{classes.map((s) => <option key={s} value={s} />)}</datalist>
            </label>
            <label className="fld" htmlFor="w-origin">
              <span className="lbl">{t('care.wounds.origin')}</span>
              <select id="w-origin" name="origin" className="field" defaultValue="in_house">
                {WOUND_ORIGINS.map((k) => <option key={k} value={k}>{t('care.wounds.origins.' + k)}</option>)}
              </select>
            </label>
            <label className="fld" htmlFor="w-start">
              <span className="lbl">{t('care.wounds.startedAt')}</span>
              <DateField id="w-start" name="startedAt" defaultValue={today} max={today} />
            </label>
          </div>
          <div className="form-actions">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <Submit>{t('common.create')}</Submit>
          </div>
        </ActionForm>
      </Dialog>
    </>
  )
}

export function WoundEntryForm({ residentId, woundId, now, storage }: { residentId: string; woundId: string; now: string; storage: boolean }) {
  const t = useT()
  const [count, setCount] = useState(0)
  const [previews, setPreviews] = useState<string[]>([])
  // Vorschau der aufgenommenen Fotos (nur im Speicher des Browsers, nicht in der Galerie)
  const pick = (files: FileList | null) => {
    previews.forEach((u) => URL.revokeObjectURL(u))
    const list = files ? Array.from(files).filter((f) => f.type.startsWith('image/')) : []
    setCount(list.length)
    setPreviews(list.slice(0, 6).map((f) => URL.createObjectURL(f)))
  }
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])
  const sel = (name: string, group: string, list: readonly string[]) => (
    <label className="fld" htmlFor={'we-' + name}>
      <span className="lbl">{t('care.wounds.' + group + 'L')}</span>
      <select id={'we-' + name} name={name} className="field" defaultValue="">
        <option value="">–</option>
        {list.map((k) => <option key={k} value={k}>{t(`care.wounds.${group}.${k}`)}</option>)}
      </select>
    </label>
  )
  return (
    <ActionForm action={(f) => saveWoundEntryAction(residentId, woundId, f)} success="care.wounds.entrySaved" onDone={(r) => { if (r.ok) pick(null) }}>
      <div className="vform" style={{ border: 0, padding: 0 }}>
        <label htmlFor="we-at" style={{ gridColumn: '1 / -1', maxWidth: 260 }}>
          <span className="lbl">{t('care.wounds.entryAt')}</span>
          <DateTimeField id="we-at" name="at" defaultValue={now} max={now} />
        </label>
        <label htmlFor="we-l"><span className="lbl">{t('care.wounds.length')}</span><input id="we-l" name="length" className="field" inputMode="decimal" autoComplete="off" /></label>
        <label htmlFor="we-w"><span className="lbl">{t('care.wounds.width')}</span><input id="we-w" name="width" className="field" inputMode="decimal" autoComplete="off" /></label>
        <label htmlFor="we-d"><span className="lbl">{t('care.wounds.depth')}</span><input id="we-d" name="depth" className="field" inputMode="decimal" autoComplete="off" /></label>
        <label htmlFor="we-p">
          <span className="lbl">{t('care.wounds.pain')}</span>
          <select id="we-p" name="pain" className="field" defaultValue="">
            <option value="">–</option>
            {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
      </div>
      <div className="form-grid">
        {sel('exudate', 'exudate', EXUDATE)}
        {sel('tissue', 'tissue', TISSUE)}
        {sel('edge', 'edge', EDGE)}
        <label className="fld span-all" htmlFor="we-desc">
          <span className="lbl">{t('care.wounds.description')}</span>
          <textarea id="we-desc" name="description" className="field" rows={2} style={{ minHeight: 56 }} />
        </label>
        <label className="fld span-all" htmlFor="we-treat">
          <span className="lbl">{t('care.wounds.treatment')}</span>
          <input id="we-treat" name="treatment" className="field" maxLength={2000} />
        </label>
        <label className="fld" htmlFor="we-mat">
          <span className="lbl">{t('care.wounds.material')}</span>
          <input id="we-mat" name="material" className="field" maxLength={300} />
        </label>
        <label className="fld" htmlFor="we-next">
          <span className="lbl">{t('care.wounds.nextChange')}</span>
          <DateTimeField id="we-next" name="nextChange" min={now} />
          <span className="hint">{t('care.wounds.nextChangeHint')}</span>
        </label>
        <div className="fld span-all">
          <span className="lbl">{t('care.wounds.photos')}</span>
          {storage ? (
            <div className="row">
              <input
                id="we-photo" name="photos" type="file" accept="image/*" capture="environment" multiple className="sr-only photo-in"
                onChange={(e) => pick(e.currentTarget.files)}
              />
              <label className="btn" htmlFor="we-photo">{t('care.wounds.photoTake')}</label>
              {count > 0 && <span className="small">{t('care.wounds.photoSelected', { n: count })}</span>}
              {previews.length > 0 && (
                <div className="thumbs" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {previews.map((u) => <img key={u} src={u} alt="" />)}
                </div>
              )}
              <span className="small muted" style={{ flexBasis: '100%' }}>{t('care.wounds.photoHint')}</span>
            </div>
          ) : (
            <div className="alert"><span className="grow">{t('care.wounds.photoUnavailable')}</span></div>
          )}
        </div>
      </div>
      <div className="form-actions">
        <Submit>{t('common.save')}</Submit>
      </div>
    </ActionForm>
  )
}

export function WoundStatusButtons({ residentId, woundId, status, who, label }: { residentId: string; woundId: string; status: 'open' | 'healing' | 'closed'; who?: string; label?: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  const [ask, confirmDialog] = useConfirm()
  const set = async (s: 'open' | 'healing' | 'closed') => {
    if (s === 'closed' && !(await ask({
      ...splitQuestion(t('care.wounds.closeConfirm')),
      context: (who || label) ? <span>{who && <strong>{who}</strong>}{who && label && ' · '}{label}</span> : undefined,
      confirmLabel: t('care.wounds.close'),
      danger: true,
    }))) return
    start(async () => {
      const r = await setWoundStatusAction(residentId, woundId, s)
      if (r.ok) toast(t(r.message ?? 'common.saved'))
      else toast(/^[a-z]+\.[\w.]+$/.test(r.error) ? t(r.error) : r.error, { kind: 'crit' })
    })
  }
  return (
    <div className="row" style={{ gap: 6 }}>
      {confirmDialog}
      {status === 'open' && <button type="button" className="btn sm" disabled={pending} onClick={() => set('healing')}>{t('care.wounds.markHealing')}</button>}
      {status === 'healing' && <button type="button" className="btn sm" disabled={pending} onClick={() => set('open')}>{t('care.wounds.markOpen')}</button>}
      {status !== 'closed' && <button type="button" className="btn sm danger" disabled={pending} onClick={() => set('closed')}>{t('care.wounds.close')}</button>}
      {status === 'closed' && <button type="button" className="btn sm" disabled={pending} onClick={() => set('open')}>{t('care.wounds.reopen')}</button>}
    </div>
  )
}
