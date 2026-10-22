'use client'

import { useT } from '@/i18n/client'
import { DateField, Select, TextField, Textarea } from '@/components/ui/fields'

export type ResidentDefaults = {
  firstName?: string; lastName?: string; birthDate?: string; sex?: string | null; roomId?: string | null; careLevel?: number | null
  physician?: string | null; rea?: string; allergies?: string[]; risks?: string[]; diet?: string | null; mobility?: string | null
  status?: string; importantNotes?: string | null; insuranceNo?: string | null; primaryNurseId?: string | null
}

/** Stammdatenfelder für Aufnahme und Bearbeitung. */
export function ResidentFields({ d = {}, rooms, nurses, edit }: {
  d?: ResidentDefaults
  rooms: { id: string; label: string }[]
  nurses?: { id: string; label: string }[]
  edit?: boolean
}) {
  const t = useT()
  const opt = <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>({t('common.optional')})</span>
  return (
    <div className="form-grid">
      <TextField label={t('residents.form.lastName')} name="lastName" required maxLength={80} defaultValue={d.lastName} autoComplete="off" />
      <TextField label={t('residents.form.firstName')} name="firstName" required maxLength={80} defaultValue={d.firstName} autoComplete="off" />
      <DateField label={t('residents.form.birthDate')} name="birthDate" required defaultValue={d.birthDate} quick={false} />
      <Select label={t('residents.form.sex')} name="sex" defaultValue={d.sex ?? ''}>
          <option value="">–</option>
          <option value="f">{t('residents.form.sexF')}</option>
          <option value="m">{t('residents.form.sexM')}</option>
          <option value="d">{t('residents.form.sexD')}</option>
        </Select>
      <Select label={t('residents.banner.room')} name="roomId" defaultValue={d.roomId ?? ''}>
          <option value="">{t('residents.form.noRoom')}</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
      <TextField label={<>{t('residents.banner.careLevel')} {opt}</>} name="careLevel" inputMode="numeric" defaultValue={d.careLevel ?? ''} className="mono" />
      <TextField label={<>{t('residents.banner.physician')} {opt}</>} name="physician" maxLength={120} defaultValue={d.physician ?? ''} />
      <Select label={t('residents.form.rea')} name="rea" defaultValue={d.rea ?? 'unknown'}>
          <option value="yes">{t('residents.banner.reaYes')}</option>
          <option value="no">{t('residents.banner.reaNo')}</option>
          <option value="unknown">{t('residents.banner.reaUnknown')}</option>
        </Select>
      {edit && nurses && (
        <Select label={t('residents.banner.primaryNurse')} name="primaryNurseId" defaultValue={d.primaryNurseId ?? ''}>
            <option value="">–</option>
            {nurses.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </Select>
      )}
      {edit && (
        <Select label={t('residents.form.status')} name="status" defaultValue={d.status ?? 'active'}>
            {['active', 'absent', 'discharged', 'deceased'].map((s) => <option key={s} value={s}>{t('residents.status.' + s)}</option>)}
          </Select>
      )}
      <TextField label={<>{t('residents.form.allergies')} {opt}</>} wrapClassName="span-all" name="allergies" defaultValue={d.allergies?.join(', ')} placeholder={t('residents.form.listHint')} />
      <TextField label={<>{t('residents.form.risks')} {opt}</>} wrapClassName="span-all" name="risks" defaultValue={d.risks?.join(', ')} placeholder={t('residents.form.listHint')} />
      <TextField label={<>{t('residents.banner.diet')} {opt}</>} name="diet" maxLength={120} defaultValue={d.diet ?? ''} />
      <TextField label={<>{t('residents.banner.mobility')} {opt}</>} name="mobility" maxLength={200} defaultValue={d.mobility ?? ''} />
      {edit && <TextField label={<>{t('residents.form.insuranceNo')} {opt}</>} name="insuranceNo" maxLength={40} defaultValue={d.insuranceNo ?? ''} className="mono" />}
      {edit && <Textarea label={<>{t('residents.overview.notes')} {opt}</>} wrapClassName="span-all" name="importantNotes" rows={3} maxLength={2000} defaultValue={d.importantNotes ?? ''} />}
    </div>
  )
}
