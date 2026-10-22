'use client'

import { useT } from '@/i18n/client'
import { DateField } from '@/components/ui/DateField'

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
      <label className="fld"><span className="lbl">{t('residents.form.lastName')}</span><input className="field" name="lastName" required maxLength={80} defaultValue={d.lastName} autoComplete="off" /></label>
      <label className="fld"><span className="lbl">{t('residents.form.firstName')}</span><input className="field" name="firstName" required maxLength={80} defaultValue={d.firstName} autoComplete="off" /></label>
      <label className="fld"><span className="lbl">{t('residents.form.birthDate')}</span><DateField name="birthDate" required defaultValue={d.birthDate} quick={false} /></label>
      <label className="fld"><span className="lbl">{t('residents.form.sex')}</span>
        <select className="field" name="sex" defaultValue={d.sex ?? ''}>
          <option value="">–</option>
          <option value="f">{t('residents.form.sexF')}</option>
          <option value="m">{t('residents.form.sexM')}</option>
          <option value="d">{t('residents.form.sexD')}</option>
        </select>
      </label>
      <label className="fld"><span className="lbl">{t('residents.banner.room')}</span>
        <select className="field" name="roomId" defaultValue={d.roomId ?? ''}>
          <option value="">{t('residents.form.noRoom')}</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label className="fld"><span className="lbl">{t('residents.banner.careLevel')} {opt}</span><input className="field mono" name="careLevel" inputMode="numeric" defaultValue={d.careLevel ?? ''} /></label>
      <label className="fld"><span className="lbl">{t('residents.banner.physician')} {opt}</span><input className="field" name="physician" maxLength={120} defaultValue={d.physician ?? ''} /></label>
      <label className="fld"><span className="lbl">{t('residents.form.rea')}</span>
        <select className="field" name="rea" defaultValue={d.rea ?? 'unknown'}>
          <option value="yes">{t('residents.banner.reaYes')}</option>
          <option value="no">{t('residents.banner.reaNo')}</option>
          <option value="unknown">{t('residents.banner.reaUnknown')}</option>
        </select>
      </label>
      {edit && nurses && (
        <label className="fld"><span className="lbl">{t('residents.banner.primaryNurse')}</span>
          <select className="field" name="primaryNurseId" defaultValue={d.primaryNurseId ?? ''}>
            <option value="">–</option>
            {nurses.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
        </label>
      )}
      {edit && (
        <label className="fld"><span className="lbl">{t('residents.form.status')}</span>
          <select className="field" name="status" defaultValue={d.status ?? 'active'}>
            {['active', 'absent', 'discharged', 'deceased'].map((s) => <option key={s} value={s}>{t('residents.status.' + s)}</option>)}
          </select>
        </label>
      )}
      <label className="fld span-all"><span className="lbl">{t('residents.form.allergies')} {opt}</span><input className="field" name="allergies" defaultValue={d.allergies?.join(', ')} placeholder={t('residents.form.listHint')} /></label>
      <label className="fld span-all"><span className="lbl">{t('residents.form.risks')} {opt}</span><input className="field" name="risks" defaultValue={d.risks?.join(', ')} placeholder={t('residents.form.listHint')} /></label>
      <label className="fld"><span className="lbl">{t('residents.banner.diet')} {opt}</span><input className="field" name="diet" maxLength={120} defaultValue={d.diet ?? ''} /></label>
      <label className="fld"><span className="lbl">{t('residents.banner.mobility')} {opt}</span><input className="field" name="mobility" maxLength={200} defaultValue={d.mobility ?? ''} /></label>
      {edit && <label className="fld"><span className="lbl">{t('residents.form.insuranceNo')} {opt}</span><input className="field mono" name="insuranceNo" maxLength={40} defaultValue={d.insuranceNo ?? ''} /></label>}
      {edit && <label className="fld span-all"><span className="lbl">{t('residents.overview.notes')} {opt}</span><textarea className="field" name="importantNotes" rows={3} maxLength={2000} defaultValue={d.importantNotes ?? ''} /></label>}
    </div>
  )
}
