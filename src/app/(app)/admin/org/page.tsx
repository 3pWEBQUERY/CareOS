import Link from 'next/link'
import { getCtx } from '@/lib/context'
import { fileUrl } from '@/lib/files'
import { storageConfigured } from '@/lib/env'
import { orgSettings } from '@/lib/admin'
import { DATA_REGIONS } from '@/lib/admin-shared'
import { LOCALES, LOCALE_NAMES } from '@/i18n/core'
import { Forbidden } from '@/components/ui/Empty'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { BrandColorField } from './BrandColor'
import { removeLogoAction, updateBrandingAction, updateOrgAction, uploadLogoAction } from './actions'

export const metadata = { title: 'Admin · Organisation' }

export default async function OrgPage() {
  const ctx = await getCtx()
  const { t, org } = ctx
  if (!ctx.can('admin.org')) return <Forbidden text={t('common.notAllowed')} />
  const settings = orgSettings(org.settings)
  const zones = Intl.supportedValuesOf('timeZone')
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.org')} sub={t('admin.org.sub')} />
      <div className="scroll">
        <div className="tabpanel">
          <section className="card" aria-labelledby="o-master">
            <div className="card-head"><h2 id="o-master">{t('admin.org.master')}</h2><span className="small muted mono">{org.slug}</span></div>
            <div className="card-body">
              <ActionForm action={updateOrgAction} reset={false} success="common.saved">
                <div className="form-grid">
                  <label className="fld span-all">
                    <span className="lbl">{t('admin.org.name')}</span>
                    <input className="field" name="name" defaultValue={org.name} required maxLength={120} />
                  </label>
                  <label className="fld">
                    <span className="lbl">{t('admin.org.terminology')}</span>
                    <select className="field" name="terminology" defaultValue={org.terminology}>
                      {(['resident', 'patient', 'client'] as const).map((k) => <option key={k} value={k}>{t('admin.org.terms.' + k)}</option>)}
                    </select>
                    <span className="hint">{t('admin.org.terminologyHint')}</span>
                  </label>
                  <label className="fld">
                    <span className="lbl">{t('admin.org.defaultLocale')}</span>
                    <select className="field" name="defaultLocale" defaultValue={org.defaultLocale}>
                      {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
                    </select>
                  </label>
                  <label className="fld">
                    <span className="lbl">{t('admin.org.timezone')}</span>
                    <input className="field" name="timezone" defaultValue={org.timezone} list="tz-list" required />
                    <datalist id="tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
                  </label>
                  <label className="fld">
                    <span className="lbl">{t('admin.org.dataRegion')}</span>
                    <select className="field" name="dataRegion" defaultValue={org.dataRegion}>
                      {DATA_REGIONS.map((r) => <option key={r} value={r}>{t('admin.org.regions.' + r.replace('-', '_'))}</option>)}
                    </select>
                    <span className="hint">{t('admin.org.dataRegionHint')}</span>
                  </label>
                  <label className="check span-all">
                    <input type="checkbox" name="requireMfaForAdmins" defaultChecked={!!settings.requireMfaForAdmins} />
                    <span>{t('admin.org.requireMfa')}</span>
                  </label>
                </div>
                <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
              </ActionForm>
            </div>
          </section>

          <section className="card" aria-labelledby="o-brand">
            <div className="card-head"><h2 id="o-brand">{t('admin.org.branding')}</h2><span className="small muted">{t('admin.org.brandingHint')}</span></div>
            <div className="card-body stack">
              <ActionForm action={updateBrandingAction} reset={false} success="common.saved">
                <div className="form-grid">
                  <label className="fld">
                    <span className="lbl">{t('admin.org.brandName')}</span>
                    <input className="field" name="brandName" defaultValue={org.brandName ?? ''} maxLength={40} placeholder="CareOS" />
                    <span className="hint">{t('admin.org.brandNameHint')}</span>
                  </label>
                  <BrandColorField initial={org.brandColor} />
                </div>
                <div className="form-actions">
                  <Submit>{t('common.save')}</Submit>
                  {org.brandColor && <Submit className="btn ghost" name="resetColor" value="true">{t('admin.org.resetColor')}</Submit>}
                </div>
              </ActionForm>
              <div className="stack-sm">
                <span className="lbl">{t('admin.org.logo')}</span>
                {org.logoFileId && (
                  <div className="row">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileUrl(org.logoFileId)} alt={t('admin.org.logoAlt')} style={{ maxHeight: 48, maxWidth: 200, border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 4, background: 'var(--surface)' }} />
                    <ActBtn action={removeLogoAction} className="btn sm danger" confirm="admin.org.removeLogoConfirm">{t('admin.org.removeLogo')}</ActBtn>
                  </div>
                )}
                {storageConfigured() ? (
                  <ActionForm action={uploadLogoAction} success="admin.org.logoSaved" className="row">
                    <input className="field" type="file" name="logo" accept="image/png,image/jpeg,image/webp" style={{ maxWidth: 320 }} aria-label={t('admin.org.logo')} />
                    <Submit className="btn">{t('admin.org.uploadLogo')}</Submit>
                  </ActionForm>
                ) : <p className="small muted" style={{ margin: 0 }}>{t('admin.org.uploadErrors.storage_not_configured')}</p>}
              </div>
            </div>
          </section>

          <section className="card" aria-labelledby="o-export">
            <div className="card-head"><h2 id="o-export">{t('admin.export.title')}</h2></div>
            <div className="card-body row-between">
              <p className="fg2" style={{ margin: 0, maxWidth: '70ch' }}>{t('admin.export.hint')}</p>
              <a className="btn" href="/admin/export" download>{t('admin.export.download')}</a>
            </div>
          </section>
          <p className="small muted" style={{ margin: 0 }}>{t('admin.org.structureHint')} <Link href="/admin/structure">{t('admin.nav.structure')}</Link></p>
        </div>
      </div>
    </main>
  )
}
