'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { ActionForm } from '@/components/ui/ActionForm'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Combobox, DateField, FileField, RadioGroup, Select, TextField, Textarea, type ComboOption } from '@/components/ui/fields'
import { createUpdateAction, deleteUpdateAction } from '../actions'

export function UpdateForm({ units, defaultUnit, residents, orgWide, storage, today }: {
  units: { value: string; label: string }[]
  defaultUnit: string
  residents: ComboOption[]
  orgWide: boolean
  storage: boolean
  today: string
}) {
  const t = useT()
  const [scope, setScope] = useState('unit')
  return (
    <ActionForm action={createUpdateAction} success="portal.team.updatePublished" onDone={(r) => r.ok && setScope('unit')}>
      <div className="form-grid">
        <TextField label={t('portal.team.updTitle')} name="title" required maxLength={120} wrapClassName="span-all" placeholder={t('portal.team.updTitlePh')} />
        <Textarea label={t('portal.team.updBody')} name="body" required rows={5} maxLength={4000} wrapClassName="span-all" hint={t('portal.team.updNever')} />
        <RadioGroup label={t('portal.team.updScope')} name="scope" value={scope} onChange={setScope} inline wrapClassName="span-all"
          options={[{ value: 'unit', label: t('portal.team.scopeUnit') }, { value: 'resident', label: t('portal.team.scopeResident') }, ...(orgWide ? [{ value: 'org', label: t('portal.team.scopeOrg') }] : [])]} />
        {scope === 'unit' && (
          <Select label={t('portal.team.unit')} name="unitId" defaultValue={defaultUnit} required>
            {units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </Select>
        )}
        {scope === 'resident' && <Combobox label={t('portal.team.resident')} name="residentId" options={residents} required />}
        <DateField label={t('portal.team.updExpires')} name="expiresAt" optional min={today} />
        {storage && <FileField label={t('portal.team.updFiles')} name="files" multiple optional accept="application/pdf,image/png,image/jpeg" wrapClassName="span-all" hint={t('portal.team.updFilesHint')} />}
      </div>
      <div className="form-actions"><span className="spacer" /><button type="submit" className="btn primary">{t('portal.team.publish')}</button></div>
    </ActionForm>
  )
}

export function DeleteUpdate({ id, title }: { id: string; title: string }) {
  const t = useT()
  const [pending, start] = useTransition()
  const [ask, dialog] = useConfirm()
  return (
    <>
      <button type="button" className="linkbtn small crit-text" disabled={pending} onClick={async () => {
        if (!(await ask({ title: t('portal.team.updDeleteConfirm'), context: <span>{title}</span>, confirmLabel: t('common.delete'), danger: true }))) return
        start(async () => {
          const r = await deleteUpdateAction(id)
          toast(r.ok ? t(r.message ?? 'common.saved') : t(r.error), r.ok ? {} : { kind: 'crit' })
        })
      }}>{t('common.delete')}</button>
      {dialog}
    </>
  )
}
