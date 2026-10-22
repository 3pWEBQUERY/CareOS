import type { TFn } from '@/i18n/core'
import { LOCALES, LOCALE_NAMES } from '@/i18n/core'
import { Select, TextField } from '@/components/ui/fields'

type U = { email: string; firstName: string; lastName: string; initials: string; jobTitle: string | null; employeeNo: string | null; phone: string | null; workPhone?: string | null; primaryUnitId: string | null; locale: string }

/** Stammdatenfelder eines Benutzers (Anlegen und Bearbeiten). */
export function UserFields({ t, units, user, defaultLocale }: { t: TFn; units: { id: string; name: string; location: { name: string } }[]; user?: U; defaultLocale: string }) {
  return (
    <div className="form-grid">
      <TextField label={t('admin.users.firstName')} name="firstName" defaultValue={user?.firstName} required maxLength={60} autoComplete="off" />
      <TextField label={t('admin.users.lastName')} name="lastName" defaultValue={user?.lastName} required maxLength={60} autoComplete="off" />
      <TextField label={t('admin.users.initials')} name="initials" defaultValue={user?.initials} maxLength={4} placeholder={t('admin.users.initialsAuto')} className="mono" />
      <TextField label={t('admin.users.email')} wrapClassName="span-all" name="email" type="email" defaultValue={user?.email} required maxLength={160} autoComplete="off" />
      <TextField label={t('admin.users.jobTitle')} name="jobTitle" defaultValue={user?.jobTitle ?? ''} maxLength={80} />
      <TextField label={t('admin.users.employeeNo')} name="employeeNo" defaultValue={user?.employeeNo ?? ''} maxLength={30} className="mono" />
      <TextField label={t('people.contact.workPhone')} name="workPhone" type="tel" defaultValue={user?.workPhone ?? ''} maxLength={40} />
      <TextField label={t('people.contact.privatePhone')} name="phone" type="tel" defaultValue={user?.phone ?? ''} maxLength={40} />
      <Select label={t('admin.users.primaryUnit')} name="primaryUnitId" defaultValue={user?.primaryUnitId ?? ''}>
          <option value="">{t('admin.structure.noUnit')}</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.location.name}</option>)}
        </Select>
      <Select label={t('admin.users.locale')} name="locale" defaultValue={user?.locale ?? defaultLocale}>{LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}</Select>
    </div>
  )
}
