import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { fmtDate } from '@/lib/time'
import { MODULES, MODULE_PACKAGES } from '@/lib/modules'
import { fmtBytes } from '@/lib/platform-core'
import { orgStats } from '@/lib/platform'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { ActBtn } from '@/components/admin/ui'
import { Switch } from '@/components/ui/fields'
import { platformAccess } from '../../access'
import { approveOrgAction, setOrgModulesAction, suspendOrgAction, unsuspendOrgAction } from '../../actions'
import { SuspendButton } from '../../SuspendButton'
import { StatusTag } from '../../StatusTag'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, ok } = await platformAccess()
  const org = ok ? await db.organization.findUnique({ where: { id: (await params).id }, select: { name: true } }) : null
  return { title: `${org?.name ?? ctx.t('tenancy.platform.detail')} · ${ctx.t('tenancy.platform.title')}` }
}

/** Organisation im Plattform-Betrieb: Zählwerte, Status, Module. Keine Personen- oder Gesundheitsdaten. */
export default async function PlatformOrg({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, ok, mfa } = await platformAccess()
  if (!ok || !mfa) return null
  const { t, locale } = ctx
  const { id } = await params
  const o = (await orgStats()).find((x) => x.id === id)
  if (!o) notFound()
  const own = o.id === ctx.org.id
  const last = await db.auditLog.findFirst({ where: { orgId: id, action: 'auth.login' }, orderBy: { at: 'desc' }, select: { at: true } })
  const dtm = (d: Date) => fmtDate(d, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <main className="panel main">
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <Link href="/platform" className="lbl" style={{ textDecoration: 'none' }}>← {t('tenancy.platform.nav.orgs')}</Link>
          <h1>{o.name}</h1>
          <p className="sub"><StatusTag status={o.status} t={t} /> <span className="mono small muted">{o.slug}</span></p>
        </div>
        <div className="row">
          {o.status === 'pending' && <ActBtn action={approveOrgAction.bind(null, o.id)} className="btn primary" confirm="tenancy.platform.approveConfirm" consequences={[t('tenancy.platform.approveHint')]} context={<strong>{o.name}</strong>}>{t('tenancy.platform.approve')}</ActBtn>}
          {o.status === 'suspended' && <ActBtn action={unsuspendOrgAction.bind(null, o.id)} className="btn" confirm="tenancy.platform.unsuspendConfirm" context={<strong>{o.name}</strong>}>{t('tenancy.platform.unsuspend')}</ActBtn>}
          {o.status !== 'suspended' && (own ? <span className="small muted">{t('tenancy.platform.ownOrg')}</span> : <SuspendButton id={o.id} name={o.name} label={o.status === 'pending' ? t('tenancy.platform.reject') : t('tenancy.platform.suspend')} action={suspendOrgAction} />)}
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel">
          <div className="metrics">
            <div className="metric"><span className="lbl">{t('tenancy.platform.col.users')}</span><span className="val">{o.users}</span></div>
            <div className="metric"><span className="lbl">{t('tenancy.platform.col.residents')}</span><span className="val">{o.residents}</span></div>
            <div className="metric"><span className="lbl">{t('tenancy.platform.col.active7')}</span><span className="val">{o.active7}</span></div>
            <div className="metric"><span className="lbl">{t('tenancy.platform.col.active30')}</span><span className="val">{o.active30}</span></div>
            <div className="metric"><span className="lbl">{t('tenancy.platform.col.storage')}</span><span className="val">{fmtBytes(o.storage)}</span></div>
          </div>
          <dl className="kv">
            <dt>{t('tenancy.platform.col.created')}</dt><dd className="mono">{dtm(o.createdAt)}</dd>
            <dt>{t('tenancy.platform.col.region')}</dt><dd>{t('admin.org.regions.' + o.dataRegion.replace('-', '_'))}</dd>
            {last && <><dt>{t('admin.users.lastLogin')}</dt><dd className="mono">{dtm(last.at)}</dd></>}
            {o.status === 'suspended' && o.suspendedReason && <><dt>{t('tenancy.platform.suspendReason')}</dt><dd>{o.suspendedReason}</dd></>}
          </dl>
          <section className="card" aria-labelledby="po-mod">
            <div className="card-head"><h2 id="po-mod">{t('tenancy.platform.modules')}</h2><span className="pill">{o.modules.length}/{MODULES.length}</span></div>
            <div className="card-body">
              <ActionForm action={setOrgModulesAction} reset={false} success="tenancy.platform.modulesSaved">
                <input type="hidden" name="id" value={o.id} />
                <p className="small muted" style={{ margin: 0 }}>{t('tenancy.modules.core')}</p>
                {MODULE_PACKAGES.map((pkg) => (
                  <fieldset key={pkg}>
                    <legend className="lbl">{t('tenancy.modules.pkg.' + pkg)}</legend>
                    <div className="grid-2" style={{ gap: 4 }}>
                      {MODULES.filter((m) => m.pkg === pkg).map((m) => (
                        <Switch key={m.key} name={'module:' + m.key} defaultChecked={o.modules.includes(m.key)} label={t('tenancy.modules.items.' + m.key + '.name')} hint={t('tenancy.modules.items.' + m.key + '.hint')} />
                      ))}
                    </div>
                  </fieldset>
                ))}
                <div className="form-actions"><Submit>{t('common.save')}</Submit></div>
              </ActionForm>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
