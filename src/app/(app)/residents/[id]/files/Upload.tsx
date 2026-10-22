'use client'

import { useT } from '@/i18n/client'
import { ActionForm } from '@/components/ui/ActionForm'
import { IconUpload } from '@/components/icons'
import { uploadResidentFile } from './actions'
import { FileField, Select, TextField } from '@/components/ui/fields'
import { MAX_UPLOAD_BYTES } from '@/lib/upload-limits'

export function Upload({ residentId, categories }: { residentId: string; categories: { value: string; label: string }[] }) {
  const t = useT()
  return (
    <ActionForm action={uploadResidentFile.bind(null, residentId)} success="residents.files.uploaded" className="card card-body form">
      <div className="form-grid">
        <FileField label={t('residents.files.fFile')} name="file" required accept="image/*,application/pdf,text/plain,text/csv,.docx,.xlsx,.pptx" maxSize={MAX_UPLOAD_BYTES} typesLabel="PDF, JPG, PNG, DOCX, XLSX, PPTX, TXT, CSV" wrapClassName="span-all" />
        <TextField label={t('residents.files.fTitle')} optional name="title" maxLength={200} />
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
