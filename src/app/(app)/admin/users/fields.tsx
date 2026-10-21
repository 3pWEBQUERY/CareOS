import type { TFn } from '@/i18n/core'
import { LOCALES, LOCALE_NAMES } from '@/i18n/core'

type U = { email: string; firstName: string; lastName: string; initials: string; jobTitle: string | null; employeeNo: string | null; phone: string | null; primaryUnitId: string | null; locale: string }

/** Stammdatenfelder eines Benutzers (Anlegen und Bearbeiten). */
export function UserFields({ t, units, user, defaultLocale }: { t: TFn; units: { id: string; name: string; location: { name: string } }[]; user?: U; defaultLocale: string }) {
  return (
    <div className="form-grid">
      <label className="fld"><span className="lbl">{t('admin.users.firstName')}</span><input className="field" name="firstName" defaultValue={user?.firstName} required maxLength={60} autoComplete="off" /></label>
      <label className="fld"><span className="lbl">{t('admin.users.lastName')}</span><input className="field" name="lastName" defaultValue={user?.lastName} required maxLength={60} autoComplete="off" /></label>
      <label className="fld"><span className="lbl">{t('admin.users.initials')}</span><input className="field mono" name="initials" defaultValue={user?.initials} maxLength={4} placeholder={t('admin.users.initialsAuto')} /></label>
      <label className="fld span-all"><span className="lbl">{t('admin.users.email')}</span><input className="field" name="email" type="email" defaultValue={user?.email} required maxLength={160} autoComplete="off" /></label>
      <label className="fld"><span className="lbl">{t('admin.users.jobTitle')}</span><input className="field" name="jobTitle" defaultValue={user?.jobTitle ?? ''} maxLength={80} /></label>
      <label className="fld"><span className="lbl">{t('admin.users.employeeNo')}</span><input className="field mono" name="employeeNo" defaultValue={user?.employeeNo ?? ''} maxLength={30} /></label>
      <label className="fld"><span className="lbl">{t('admin.users.phone')}</span><input className="field" name="phone" type="tel" defaultValue={user?.phone ?? ''} maxLength={40} /></label>
      <label className="fld">
        <span className="lbl">{t('admin.users.primaryUnit')}</span>
        <select className="field" name="primaryUnitId" defaultValue={user?.primaryUnitId ?? ''}>
          <option value="">{t('admin.structure.noUnit')}</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.location.name}</option>)}
        </select>
      </label>
      <label className="fld">
        <span className="lbl">{t('admin.users.locale')}</span>
        <select className="field" name="locale" defaultValue={user?.locale ?? defaultLocale}>{LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}</select>
      </label>
    </div>
  )
}
