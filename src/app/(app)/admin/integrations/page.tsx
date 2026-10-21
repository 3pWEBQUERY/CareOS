import Link from 'next/link'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getCtx } from '@/lib/context'
import { fmtDate, fmtRel } from '@/lib/time'
import { API_SCOPES, EVENT_TYPES, INTEGRATION_KINDS } from '@/lib/admin-shared'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ActBtn, FormDialog, SecretDialog, SecretForm } from '@/components/admin/ui'
import { AdminHead } from '../Head'
import { maskConfig } from './mask'
import {
  createTokenAction, createWebhookAction, deleteIntegrationAction, deleteWebhookAction, revokeTokenAction,
  rotateWebhookSecretAction, saveIntegrationAction, testWebhookAction, updateWebhookAction,
} from './actions'

export const metadata = { title: 'Admin · Integrationen & API' }

const TABS = ['api', 'webhooks', 'integrations', 'export'] as const
type Tab = (typeof TABS)[number]

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('admin.integrations')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const tabs = TABS.filter((k) => k !== 'export' || ctx.can('admin.org'))
  const tab: Tab = (tabs as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'api'
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('admin.nav.integrations')} sub={t('admin.integrations.sub')} />
      <nav className="tabs" aria-label={t('admin.nav.integrations')}>
        {tabs.map((k) => <Link key={k} href={`/admin/integrations?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>{t('admin.integrations.tabs.' + k)}</Link>)}
      </nav>
      <div className="scroll">
        <div className="tabpanel">
          {tab === 'api' && <ApiTokens />}
          {tab === 'webhooks' && <Webhooks />}
          {tab === 'integrations' && <Integrations />}
          {tab === 'export' && <Export />}
        </div>
      </div>
    </main>
  )
}

async function ApiTokens() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  const now = new Date()
  const tokens = await db.apiToken.findMany({ where: { orgId: ctx.org.id }, orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }] })
  const creators = await db.user.findMany({ where: { id: { in: tokens.map((x) => x.createdById) } }, select: { id: true, firstName: true, lastName: true } })
  const who = new Map(creators.map((u) => [u.id, `${u.firstName} ${u.lastName}`]))
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)
  return (
    <>
      <dl className="kv">
        <dt>{t('admin.api.restBase')}</dt><dd><code className="mono">{env.appUrl}/api/v1</code></dd>
        <dt>{t('admin.api.fhirBase')}</dt><dd><code className="mono">{env.appUrl}/api/fhir</code> <a className="small" href="/api/fhir/metadata" target="_blank" rel="noreferrer">CapabilityStatement</a></dd>
        <dt>{t('admin.api.auth')}</dt><dd><code className="mono">Authorization: Bearer cos_…</code></dd>
      </dl>
      <section className="card" aria-labelledby="api-new">
        <div className="card-head"><h2 id="api-new">{t('admin.api.create')}</h2></div>
        <div className="card-body">
          <SecretForm action={createTokenAction} submit={t('admin.api.createSubmit')} intro={t('admin.api.once')} label={t('admin.api.token')} success="admin.api.tokenCreated">
            <label className="fld" style={{ maxWidth: 420 }}><span className="lbl">{t('admin.api.name')}</span><input className="field" name="name" required maxLength={80} placeholder={t('admin.api.namePlaceholder')} /></label>
            <fieldset>
              <legend className="lbl">{t('admin.api.scopes')}</legend>
              <div className="grid-3" style={{ gap: 4 }}>
                {API_SCOPES.map((s) => (
                  <label key={s} className="check"><input type="checkbox" name="scopes" value={s} /><span><code className="mono small">{s}</code> <span className="small muted">{t('admin.api.scopeHints.' + s.replace(':', '_'))}</span></span></label>
                ))}
              </div>
            </fieldset>
          </SecretForm>
        </div>
      </section>
      {tokens.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead><tr><th>{t('admin.api.name')}</th><th>{t('admin.api.scopes')}</th><th>{t('admin.api.createdBy')}</th><th>{t('admin.api.lastUsed')}</th><th>{t('admin.api.status')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
            <tbody>
              {tokens.map((k) => (
                <tr key={k.id}>
                  <th scope="row">{k.name}</th>
                  <td><div className="chips">{k.scopes.map((s) => <code key={s} className="tag outline" style={{ textTransform: 'none', fontFamily: 'var(--font-mono)' }}>{s}</code>)}</div></td>
                  <td className="small">{who.get(k.createdById) ?? '–'}<div className="muted mono">{fmtDate(k.createdAt, locale)}</div></td>
                  <td className="num nowrap">{k.lastUsedAt ? rel(k.lastUsedAt) : <span className="muted">{t('admin.users.never')}</span>}</td>
                  <td>{k.revokedAt ? <span className="tag crit">{t('admin.api.revoked')}</span> : <span className="tag ok">{t('admin.config.active')}</span>}</td>
                  <td className="right">{!k.revokedAt && <ActBtn action={revokeTokenAction.bind(null, k.id)} className="btn sm danger" confirm="admin.api.revokeConfirm">{t('admin.api.revoke')}</ActBtn>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title={t('admin.api.none')} />}
    </>
  )
}

async function Webhooks() {
  const ctx = await getCtx()
  const { t } = ctx
  const now = new Date()
  const hooks = await db.webhook.findMany({ where: { orgId: ctx.org.id }, include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 8 } }, orderBy: { createdAt: 'asc' } })
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now)
  const events = (sel: string[] = []) => (
    <fieldset>
      <legend className="lbl">{t('admin.webhooks.events')}</legend>
      <label className="check"><input type="checkbox" name="events" value="*" defaultChecked={sel.includes('*')} /><span>{t('admin.webhooks.allEvents')}</span></label>
      <div className="grid-3" style={{ gap: 0, marginTop: 4 }}>
        {EVENT_TYPES.map((e) => <label key={e} className="check"><input type="checkbox" name="events" value={e} defaultChecked={sel.includes(e)} /><code className="mono small">{e}</code></label>)}
      </div>
    </fieldset>
  )
  return (
    <>
      <p className="fg2" style={{ margin: 0 }}>{t('admin.webhooks.hint')} <code className="mono small">x-careos-signature: sha256=…</code></p>
      <section className="card" aria-labelledby="wh-new">
        <div className="card-head"><h2 id="wh-new">{t('admin.webhooks.create')}</h2></div>
        <div className="card-body">
          <SecretForm action={createWebhookAction} submit={t('admin.webhooks.createSubmit')} intro={t('admin.webhooks.once')} label={t('admin.webhooks.secret')} success="admin.webhooks.created">
            <label className="fld"><span className="lbl">{t('admin.webhooks.url')}</span><input className="field mono" name="url" type="url" required placeholder="https://example.org/careos/hook" /></label>
            {events()}
          </SecretForm>
        </div>
      </section>
      {hooks.length ? hooks.map((h) => (
        <section key={h.id} className="card" aria-label={h.url}>
          <div className="card-head">
            <div style={{ minWidth: 0 }}>
              <h3 className="mono ellipsis" style={{ fontWeight: 500 }}>{h.url}</h3>
              <span className="small muted">{h.events.includes('*') ? t('admin.webhooks.allEvents') : t('admin.webhooks.eventCount', { n: h.events.length })}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {h.active ? <span className="tag ok">{t('admin.config.active')}</span> : <span className="tag">{t('admin.config.inactive')}</span>}
              <ActBtn action={testWebhookAction.bind(null, h.id)} className="btn sm">{t('admin.webhooks.test')}</ActBtn>
              <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={t('admin.webhooks.edit')} action={updateWebhookAction} submit={t('common.save')} success="common.saved" wide>
                <input type="hidden" name="id" value={h.id} />
                <label className="fld"><span className="lbl">{t('admin.webhooks.url')}</span><input className="field mono" name="url" type="url" defaultValue={h.url} required /></label>
                <label className="check"><input type="checkbox" name="active" defaultChecked={h.active} /><span>{t('admin.config.active')}</span></label>
                {events(h.events)}
              </FormDialog>
              <SecretDialog label={t('admin.webhooks.rotate')} buttonClass="btn sm ghost" title={t('admin.webhooks.rotate')} action={rotateWebhookSecretAction} submit={t('admin.webhooks.rotate')} intro={t('admin.webhooks.once')} secretLabel={t('admin.webhooks.secret')} submitClass="btn danger">
                <input type="hidden" name="id" value={h.id} />
                <p className="fg2" style={{ margin: 0 }}>{t('admin.webhooks.rotateHint')}</p>
              </SecretDialog>
              <ActBtn action={deleteWebhookAction.bind(null, h.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm">{t('common.delete')}</ActBtn>
            </div>
          </div>
          {h.deliveries.length ? (
            <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="stable">
                <thead><tr><th>{t('admin.webhooks.when')}</th><th>{t('admin.webhooks.event')}</th><th>{t('admin.webhooks.status')}</th><th className="right">{t('admin.webhooks.attempts')}</th><th>{t('admin.webhooks.error')}</th></tr></thead>
                <tbody>
                  {h.deliveries.map((d) => {
                    const ok = d.status != null && d.status >= 200 && d.status < 300
                    return (
                      <tr key={d.id}>
                        <td className="num nowrap">{rel(d.createdAt)}</td>
                        <td className="mono small">{d.eventId.startsWith('test_') ? t('admin.webhooks.testEvent') : d.eventId.slice(0, 12)}</td>
                        <td><span className={'tag ' + (ok ? 'ok' : 'crit')}>{ok ? '✓ ' : '✕ '}{d.status ?? t('admin.webhooks.noResponse')}</span></td>
                        <td className="num right">{d.attempts}</td>
                        <td className="small muted" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{d.error ?? '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="card-body small muted">{t('admin.webhooks.noDeliveries')}</div>}
        </section>
      )) : <Empty title={t('admin.webhooks.none')} />}
    </>
  )
}

async function Integrations() {
  const ctx = await getCtx()
  const { t } = ctx
  const items = await db.integration.findMany({ where: { orgId: ctx.org.id }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] })
  const fields = (it?: (typeof items)[number]) => (
    <>
      {it && <input type="hidden" name="id" value={it.id} />}
      <div className="form-grid">
        <label className="fld">
          <span className="lbl">{t('admin.integrations.kind')}</span>
          <select className="field" name="kind" defaultValue={it?.kind ?? 'hl7_fhir'}>{INTEGRATION_KINDS.map((k) => <option key={k} value={k}>{t('admin.integrations.kinds.' + k)}</option>)}</select>
        </label>
        <label className="fld"><span className="lbl">{t('admin.integrations.name')}</span><input className="field" name="name" defaultValue={it?.name} required maxLength={80} /></label>
        <label className="fld span-all">
          <span className="lbl">{t('admin.integrations.config')}</span>
          <textarea className="field mono" name="config" rows={8} defaultValue={JSON.stringify(it ? maskConfig((it.config ?? {}) as Record<string, unknown>) : { endpoint: 'https://' }, null, 2)} spellCheck={false} />
          <span className="hint">{t('admin.integrations.configHint')}</span>
        </label>
        <label className="check"><input type="checkbox" name="active" defaultChecked={it?.active ?? false} /><span>{t('admin.config.active')}</span></label>
      </div>
    </>
  )
  return (
    <>
      <div className="row-between">
        <p className="fg2" style={{ margin: 0, maxWidth: '80ch' }}>{t('admin.integrations.hint')}</p>
        <FormDialog label={t('admin.integrations.create')} buttonClass="btn sm" title={t('admin.integrations.create')} action={saveIntegrationAction} submit={t('common.save')} success="common.saved" wide>{fields()}</FormDialog>
      </div>
      {items.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead><tr><th>{t('admin.integrations.name')}</th><th>{t('admin.integrations.kind')}</th><th>{t('admin.integrations.config')}</th><th>{t('admin.api.status')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <th scope="row">{it.name}</th>
                  <td><span className="tag outline">{t('admin.integrations.kinds.' + it.kind)}</span></td>
                  <td className="mono small muted" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{Object.keys((it.config ?? {}) as object).join(', ') || '–'}</td>
                  <td>{it.active ? <span className="tag ok">{t('admin.config.active')}</span> : <span className="tag">{t('admin.config.inactive')}</span>}</td>
                  <td className="right nowrap">
                    <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={it.name} action={saveIntegrationAction} submit={t('common.save')} success="common.saved" wide>{fields(it)}</FormDialog>
                    <ActBtn action={deleteIntegrationAction.bind(null, it.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm">{t('common.delete')}</ActBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title={t('admin.integrations.none')}>{t('admin.integrations.noneHint')}</Empty>}
      <h2 className="sec">{t('admin.integrations.available')}</h2>
      <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', background: 'var(--surface)' }}>
        {INTEGRATION_KINDS.map((k) => (
          <li key={k}><div className="li"><div className="grow"><div>{t('admin.integrations.kinds.' + k)}</div><div className="small muted">{t('admin.integrations.kindHints.' + k)}</div></div><code className="mono small muted">{k}</code></div></li>
        ))}
      </ul>
    </>
  )
}

async function Export() {
  const ctx = await getCtx()
  const { t } = ctx
  const last = await db.auditLog.findFirst({ where: { orgId: ctx.org.id, action: 'admin.export.org' }, orderBy: { at: 'desc' } })
  return (
    <section className="card" aria-labelledby="ex-title">
      <div className="card-head"><h2 id="ex-title">{t('admin.export.title')}</h2>{last && <span className="small muted">{t('admin.export.last', { date: fmtDate(last.at, ctx.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</span>}</div>
      <div className="card-body stack-sm">
        <p className="fg2" style={{ margin: 0, maxWidth: '75ch' }}>{t('admin.export.hint')}</p>
        <div className="alert warn"><span className="grow">{t('admin.export.warning')}</span></div>
        <div><a className="btn primary" href="/admin/export" download>{t('admin.export.download')}</a></div>
      </div>
    </section>
  )
}
