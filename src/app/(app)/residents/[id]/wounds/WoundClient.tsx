'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { useConfirm, splitQuestion } from '@/components/ui/ConfirmDialog'
import { Dialog } from '@/components/ui/Dialog'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { EDGE, EXUDATE, TISSUE, WOUND_KINDS, WOUND_ORIGINS } from '@/lib/care'
import { correctWoundEntryAction, createWoundAction, saveWoundEntryAction, setWoundStatusAction } from './actions'
import { CorrectionDialog } from '@/components/residents/CorrectionDialog'
import { Combobox, DateField, DateTimeField, FileField, NumberField, Select, TextField, Textarea } from '@/components/ui/fields'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits'

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
            <Combobox label={t('care.wounds.bodySite')} id="w-site" name="bodySite" freeText maxLength={120} required placeholder=" " options={sites.map((s) => ({ value: s, label: s }))} />
            <Select label={t('care.wounds.kind')} id="w-kind" name="kind" defaultValue="pressure">
                {WOUND_KINDS.map((k) => <option key={k} value={k}>{t('care.wounds.kinds.' + k)}</option>)}
              </Select>
            <Combobox label={t('care.wounds.classification')} optional id="w-class" name="classification" freeText maxLength={120} placeholder=" " options={classes.map((s) => ({ value: s, label: s }))} />
            <Select label={t('care.wounds.origin')} id="w-origin" name="origin" defaultValue="in_house">
                {WOUND_ORIGINS.map((k) => <option key={k} value={k}>{t('care.wounds.origins.' + k)}</option>)}
              </Select>
            <DateField label={t('care.wounds.startedAt')} id="w-start" name="startedAt" defaultValue={today} max={today} />
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
  const sel = (name: string, group: string, list: readonly string[]) => (
    <Select label={t('care.wounds.' + group + 'L')} id={'we-' + name} name={name} defaultValue="">
        <option value="">–</option>
        {list.map((k) => <option key={k} value={k}>{t(`care.wounds.${group}.${k}`)}</option>)}
      </Select>
  )
  return (
    <ActionForm action={(f) => saveWoundEntryAction(residentId, woundId, f)} success="care.wounds.entrySaved" >
      <div className="vform" style={{ border: 0, padding: 0 }}>
        <DateTimeField label={t('care.wounds.entryAt')} wrapStyle={{ gridColumn: '1 / -1', maxWidth: 260 }} id="we-at" name="at" defaultValue={now} max={now} />
        <NumberField label={t('care.wounds.length')} id="we-l" name="length" min={0} max={1000} />
        <NumberField label={t('care.wounds.width')} id="we-w" name="width" min={0} max={1000} />
        <NumberField label={t('care.wounds.depth')} id="we-d" name="depth" min={0} max={1000} />
        <Select label={t('care.wounds.pain')} id="we-p" name="pain" defaultValue="">
            <option value="">–</option>
            {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
          </Select>
      </div>
      <div className="form-grid">
        {sel('exudate', 'exudate', EXUDATE)}
        {sel('tissue', 'tissue', TISSUE)}
        {sel('edge', 'edge', EDGE)}
        <Textarea label={t('care.wounds.description')} wrapClassName="span-all" id="we-desc" name="description" rows={2} style={{ minHeight: 56 }} />
        <TextField label={t('care.wounds.treatment')} wrapClassName="span-all" id="we-treat" name="treatment" maxLength={2000} />
        <TextField label={t('care.wounds.material')} id="we-mat" name="material" maxLength={300} />
        <DateTimeField label={t('care.wounds.nextChange')} hint={t('care.wounds.nextChangeHint')} id="we-next" name="nextChange" min={now} />
        {storage ? (
          <FileField label={t('care.wounds.photos')} hint={t('care.wounds.photoHint')} id="we-photo" name="photos" accept="image/*" capture="environment" multiple
            maxSize={MAX_UPLOAD_BYTES} chooseLabel={t('care.wounds.photoTake')} wrapClassName="span-all" />
        ) : (
          <div className="fld span-all">
            <span className="lbl">{t('care.wounds.photos')}</span>
            <div className="alert"><span className="grow">{t('care.wounds.photoUnavailable')}</span></div>
          </div>
        )}
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

export type WoundEntryValues = {
  lengthMm: number | null; widthMm: number | null; depthMm: number | null; pain: number | null
  exudate: string | null; tissue: string | null; edge: string | null
  description: string | null; treatment: string | null; material: string | null
}

/** «Korrigieren» in der Wundhistorie: Befund vorbelegt; Zeitpunkt, Fotos und Verbandwechsel bleiben (PRD §35). */
export function CorrectWoundEntry({ residentId, entryId, who, when, summary, values }: {
  residentId: string; entryId: string; who: string; when: string; summary: string; values: WoundEntryValues
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const num = (v: number | null) => (v == null ? '' : String(v))
  const sel = (name: 'exudate' | 'tissue' | 'edge', list: readonly string[]) => (
    <Select label={t('care.wounds.' + name + 'L')} name={name} defaultValue={values[name] ?? ''}>
      <option value="">–</option>
      {list.map((k) => <option key={k} value={k}>{t(`care.wounds.${name}.${k}`)}</option>)}
    </Select>
  )
  return (
    <>
      <button type="button" className="linkbtn small" onClick={() => setOpen(true)} aria-label={`${t('chart.void.action')}: ${when}`}>{t('chart.void.action')}</button>
      {open && (
        <CorrectionDialog
          open
          onClose={() => setOpen(false)}
          title={t('chart.void.titleWound')}
          who={who}
          original={<><span className="mono">{when}</span> · {summary}</>}
          action={(f) => correctWoundEntryAction(residentId, entryId, f)}
          fields={
            <div className="form-grid">
              <NumberField label={t('care.wounds.length')} name="length" min={0} max={1000} defaultValue={num(values.lengthMm)} />
              <NumberField label={t('care.wounds.width')} name="width" min={0} max={1000} defaultValue={num(values.widthMm)} />
              <NumberField label={t('care.wounds.depth')} name="depth" min={0} max={1000} defaultValue={num(values.depthMm)} />
              <Select label={t('care.wounds.pain')} name="pain" defaultValue={num(values.pain)}>
                <option value="">–</option>
                {Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}
              </Select>
              {sel('exudate', EXUDATE)}
              {sel('tissue', TISSUE)}
              {sel('edge', EDGE)}
              <Textarea label={t('care.wounds.description')} wrapClassName="span-all" name="description" rows={2} defaultValue={values.description ?? ''} />
              <TextField label={t('care.wounds.treatment')} wrapClassName="span-all" name="treatment" maxLength={2000} defaultValue={values.treatment ?? ''} />
              <TextField label={t('care.wounds.material')} name="material" maxLength={300} defaultValue={values.material ?? ''} />
            </div>
          }
        />
      )}
    </>
  )
}
