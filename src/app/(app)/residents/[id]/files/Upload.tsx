'use client'

import { useT } from '@/i18n/client'
import { ActionForm } from '@/components/ui/ActionForm'
import { IconUpload } from '@/components/icons'
import { uploadResidentFile } from './actions'
import { Select, TextField } from '@/components/ui/fields'

export function Upload({ residentId, categories }: { residentId: string; categories: { value: string; label: string }[] }) {
  const t = useT()
  return (
    <ActionForm action={uploadResidentFile.bind(null, residentId)} success="residents.files.uploaded" className="card card-body form">
      <div className="form-grid">
        <label className="fld"><span className="lbl">{t('residents.files.fFile')}</span><input className="field" type="file" name="file" required accept="image/*,application/pdf,text/plain,text/csv,.docx,.xlsx,.pptx" /></label>
        <TextField label={<>{t('residents.files.fTitle')} <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>({t('common.optional')})</span></>} name="title" maxLength={200} />
        <Select label={t('residents.files.fCategory')} name="category" defaultValue="report">{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>
      </div>
      <div className="form-actions">
        <span className="small muted">{t('residents.files.hint')}</span>
        <span className="spacer" />
        <button type="submit" className="btn primary"><IconUpload size={16} />{t('residents.files.submit')}</button>
      </div>
    </ActionForm>
  )
}
