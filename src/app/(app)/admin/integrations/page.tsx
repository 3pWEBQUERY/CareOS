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
  rotateWebhookSecretAction, saveIntegrationAction, testWebhookAction, updateWebhookAction, testIntegrationAction, importIntegrationAction,
} from './actions'
import { ADAPTERS } from '@/lib/integrations/registry'
import { Checkbox, Select, TextField, Textarea } from '@/components/ui/fields'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('admin.nav.integrations')} · ${t('nav.admin')}` }
}

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
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)
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
            <TextField label={t('admin.api.name')} wrapStyle={{ maxWidth: 420 }} name="name" required maxLength={80} placeholder={t('admin.api.namePlaceholder')} />
            <fieldset>
              <legend className="lbl">{t('admin.api.scopes')}</legend>
              <div className="grid-3" style={{ gap: 4 }}>
                {API_SCOPES.map((s) => (
                  <Checkbox key={s} name="scopes" value={s} label={<><code className="mono small">{s}</code> <span className="small muted">{t('admin.api.scopeHints.' + s.replace(':', '_'))}</span></>} />
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
                  <td className="right">{!k.revokedAt && <ActBtn action={revokeTokenAction.bind(null, k.id)} className="btn sm danger" confirm="admin.api.revokeConfirm" context={<span><strong>{k.name}</strong> · {k.scopes.join(', ')} · {t('admin.api.lastUsed')}: {k.lastUsedAt ? rel(k.lastUsedAt) : t('admin.users.never')}</span>} consequences={[t('admin.ux.revokeFinal')]}>{t('admin.api.revoke')}</ActBtn>}</td>
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
  const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, ctx.locale)
  const events = (sel: string[] = []) => (
    <fieldset>
      <legend className="lbl">{t('admin.webhooks.events')}</legend>
      <Checkbox name="events" value="*" defaultChecked={sel.includes('*')} label={t('admin.webhooks.allEvents')} />
      <div className="grid-3" style={{ gap: 0, marginTop: 4 }}>
        {EVENT_TYPES.map((e) => <Checkbox key={e} name="events" value={e} defaultChecked={sel.includes(e)} label={<code className="mono small">{e}</code>} />)}
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
            <TextField label={t('admin.webhooks.url')} name="url" type="url" required placeholder="https://example.org/careos/hook" className="mono" />
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
                <TextField label={t('admin.webhooks.url')} name="url" type="url" defaultValue={h.url} required className="mono" />
                <Checkbox name="active" defaultChecked={h.active} label={t('admin.config.active')} />
                {events(h.events)}
              </FormDialog>
              <SecretDialog label={t('admin.webhooks.rotate')} buttonClass="btn sm ghost" title={t('admin.webhooks.rotate')} action={rotateWebhookSecretAction} submit={t('admin.webhooks.rotate')} intro={t('admin.webhooks.once')} secretLabel={t('admin.webhooks.secret')} submitClass="btn danger">
                <input type="hidden" name="id" value={h.id} />
                <p className="fg2" style={{ margin: 0 }}>{t('admin.webhooks.rotateHint')}</p>
              </SecretDialog>
              <ActBtn action={deleteWebhookAction.bind(null, h.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm" context={<span className="mono">{h.url}</span>}>{t('common.delete')}</ActBtn>
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
  const runs = await db.integrationRun.findMany({ where: { orgId: ctx.org.id }, orderBy: { startedAt: 'desc' }, take: 15 })
  const itName = new Map(items.map((i) => [i.id, i.name]))
  const dtm = (d: Date) => fmtDate(d, ctx.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const fields = (it?: (typeof items)[number]) => (
    <>
      {it && <input type="hidden" name="id" value={it.id} />}
      <div className="form-grid">
        <Select label={t('admin.integrations.kind')} name="kind" defaultValue={it?.kind ?? 'hl7_fhir'}>{INTEGRATION_KINDS.map((k) => <option key={k} value={k}>{t('admin.integrations.kinds.' + k)}</option>)}</Select>
        <TextField label={t('admin.integrations.name')} name="name" defaultValue={it?.name} required maxLength={80} />
        <Textarea label={t('admin.integrations.config')} hint={t('admin.integrations.configHint')} wrapClassName="span-all" name="config" rows={8} defaultValue={JSON.stringify(it ? maskConfig((it.config ?? {}) as Record<string, unknown>) : { endpoint: 'https://' }, null, 2)} spellCheck={false} className="mono" />
        <Checkbox name="active" defaultChecked={it?.active ?? false} label={t('admin.config.active')} />
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
            <thead><tr><th>{t('admin.integrations.name')}</th><th>{t('admin.integrations.kind')}</th><th>{t('admin.integrations.config')}</th><th>{t('platform.integrations.adapter')}</th><th>{t('admin.api.status')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <th scope="row">{it.name}</th>
                  <td><span className="tag outline">{t('admin.integrations.kinds.' + it.kind)}</span></td>
                  <td className="mono small muted" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{Object.keys((it.config ?? {}) as object).join(', ') || '–'}</td>
                  <td>{ADAPTERS[it.kind]?.status === 'ready' ? <span className="tag ok">{t('platform.integrations.ready')}</span> : <span className="tag outline">{t('platform.integrations.prepared')}</span>}</td>
                  <td>{it.active ? <span className="tag ok">{t('admin.config.active')}</span> : <span className="tag">{t('admin.config.inactive')}</span>}</td>
                  <td className="right nowrap">
                    <ActBtn action={testIntegrationAction.bind(null, it.id)} className="btn sm">{t('platform.integrations.test')}</ActBtn>
                    {ADAPTERS[it.kind]?.import && it.active && (
                      <FormDialog label={t('platform.integrations.labImport')} buttonClass="btn sm ghost" title={`${it.name} · ${t('platform.integrations.labImport')}`} action={importIntegrationAction} submit={t('platform.integrations.labImport')} wide>
                        <input type="hidden" name="id" value={it.id} />
                        <Textarea label={t('platform.integrations.labPayload')} hint={t('platform.integrations.labImportHint')} name="payload" rows={10} required spellCheck={false} className="mono" defaultValue={'[\n  { "residentId": "…", "externalId": "L-1", "code": "2951-2", "name": "Natrium", "value": "131", "unit": "mmol/l", "refRange": "135-145", "collectedAt": "2026-10-22T07:30:00+02:00" }\n]'} />
                      </FormDialog>
                    )}
                    <FormDialog label={t('common.edit')} buttonClass="btn sm ghost" title={it.name} action={saveIntegrationAction} submit={t('common.save')} success="common.saved" wide>{fields(it)}</FormDialog>
                    <ActBtn action={deleteIntegrationAction.bind(null, it.id)} className="btn sm ghost" confirm="admin.common.deleteConfirm" context={<strong>{it.name}</strong>}>{t('common.delete')}</ActBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title={t('admin.integrations.none')}>{t('admin.integrations.noneHint')}</Empty>}
      <h2 className="sec">{t('platform.integrations.runs')}</h2>
      {runs.length ? (
        <div className="tablewrap">
          <table className="stable">
            <thead><tr><th>{t('admin.webhooks.when')}</th><th>{t('admin.integrations.name')}</th><th>{t('platform.integrations.operation')}</th><th>{t('admin.api.status')}</th><th className="right">{t('platform.integrations.recordsCol')}</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="num nowrap">{dtm(r.startedAt)}</td>
                  <td>{itName.get(r.integrationId) ?? <span className="muted mono small">{r.integrationId.replace(/^kind:/, '')}</span>}</td>
                  <td>{t('platform.integrations.operations.' + r.operation)}{r.trigger !== 'manual' ? <span className="small muted"> · {r.trigger}</span> : null}</td>
                  <td>{r.ok ? <span className="tag ok">✓ {t('platform.integrations.ok')}</span> : r.ok === false ? <span className="tag crit">✕ {t('platform.integrations.failed')}</span> : <span className="tag">…</span>}{r.error && <div className="small muted mono" style={{ overflowWrap: 'anywhere' }}>{r.error}</div>}</td>
                  <td className="num right">{r.records}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="small muted" style={{ margin: 0 }}>{t('platform.integrations.noRuns')}</p>}
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
