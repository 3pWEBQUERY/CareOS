import Link from 'next/link'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getCtx } from '@/lib/context'
import { fmtDate, fmtRel } from '@/lib/time'
import { API_SCOPES, EVENT_TYPES, permKey } from '@/lib/admin-shared'
import { API_OPERATIONS, operationId } from '@/lib/api-spec'
import { SCOPE_PERMISSIONS, TOKEN_DAYS, allowedScopes, tokenState } from '@/lib/api-tokens'
import { Forbidden, Empty } from '@/components/ui/Empty'
import { ActBtn, SecretForm } from '@/components/admin/ui'
import { Checkbox, Select, TextField } from '@/components/ui/fields'
import { testWebhookAction } from '../admin/integrations/actions'
import { createPersonalTokenAction, revokePersonalTokenAction } from './actions'

export async function generateMetadata() {
  return { title: (await getCtx()).t('developer.title') }
}

const TABS = ['reference', 'tokens', 'webhooks'] as const
type Tab = (typeof TABS)[number]

const NODE_VERIFY = `import { createHmac, timingSafeEqual } from 'node:crypto'

export function verify(rawBody, header, secret) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(header ?? '')
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}`

const PY_VERIFY = `import hashlib, hmac

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or '')`

/** Developer-Portal (PRD §60): Referenz aus src/lib/api-spec.ts, persönliche Tokens, Webhook-Test. */
export default async function DeveloperPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getCtx()
  const { t } = ctx
  const personal = ctx.can('api.personal')
  const integrations = ctx.can('admin.integrations')
  if (!personal && !integrations) return <Forbidden text={t('common.notAllowed')} />
  const tabs = TABS.filter((k) => (k === 'tokens' ? personal : k === 'webhooks' ? integrations : true))
  const sp = await searchParams
  const tab: Tab = (tabs as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'reference'
  return (
    <main className="panel main">
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <div className="lbl">{ctx.org.name}</div>
          <h1>{t('developer.title')}</h1>
          <p className="sub">{t('developer.sub')}</p>
        </div>
        <div className="row"><a className="btn" href="/api/v1/openapi.json" download="careos-openapi.json">{t('developer.download')}</a></div>
      </div>
      <nav className="tabs" aria-label={t('developer.title')}>
        {tabs.map((k) => <Link key={k} href={`/developer?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>{t('developer.tabs.' + k)}</Link>)}
      </nav>
      <div className="scroll">
        <div className="tabpanel">
          {tab === 'reference' && <Reference />}
          {tab === 'tokens' && <Tokens />}
          {tab === 'webhooks' && <Webhooks />}
        </div>
      </div>
    </main>
  )

  function Reference() {
    const base = env.appUrl
    const tags = [...new Set(API_OPERATIONS.map((o) => o.tag))]
    return (
      <>
        <dl className="kv">
          <dt>{t('developer.base.rest')}</dt><dd><code className="mono">{base}/api/v1</code></dd>
          <dt>{t('developer.base.fhir')}</dt><dd><code className="mono">{base}/api/fhir</code> <a className="small" href="/api/fhir/metadata" target="_blank" rel="noreferrer">{t('developer.base.capability')}</a></dd>
          <dt>{t('developer.base.auth')}</dt><dd><code className="mono">Authorization: Bearer cos_…</code></dd>
          <dt>{t('developer.base.spec')}</dt><dd><a className="mono" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a> <span className="small muted">OpenAPI 3.1</span></dd>
        </dl>
        <p className="fg2" style={{ margin: 0, maxWidth: '80ch' }}>{t('developer.intro')}</p>
        <p className="small muted" style={{ margin: 0, maxWidth: '80ch' }}>{t('developer.limits')}</p>

        <h2 className="sec">{t('developer.endpoints')}</h2>
        {tags.map((tag) => (
          <section key={tag} aria-labelledby={'dev-' + tag} className="stack-sm">
            <h3 id={'dev-' + tag} className="lbl">{t('developer.tags.' + tag)}</h3>
            <ul className="list dev-ops">
              {API_OPERATIONS.filter((o) => o.tag === tag).map((o) => {
                const example = o.body
                  ? `curl -X ${o.method.toUpperCase()} ${base}${o.path} \\\n  -H "Authorization: Bearer $CAREOS_TOKEN" \\\n  -H "Content-Type: ${o.contentType ?? (o.fhir ? 'application/fhir+json' : 'application/json')}" \\\n  ${typeof o.bodyExample === 'string' ? '--data-binary @message.hl7' : `-d '${JSON.stringify(o.bodyExample ?? {})}'`}`
                  : `curl ${o.scope ? '-H "Authorization: Bearer $CAREOS_TOKEN" ' : ''}"${base}${o.path}"`
                return (
                  <li key={o.method + o.path}>
                    <details className="dev-op">
                      <summary>
                        <span className={'tag outline mono dev-m dev-' + o.method}>{o.method.toUpperCase()}</span>
                        <code className="mono dev-path">{o.path}</code>
                        <span className="grow small fg2">{t('developer.ops.' + operationId(o))}</span>
                        <code className="mono small muted">{o.scope ?? t('developer.public')}</code>
                      </summary>
                      <div className="dev-op-body">
                        {o.params?.length ? (
                          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                            <span className="lbl">{t('developer.params')}</span>
                            {o.params.map((p) => <code key={p.name} className="tag outline mono dev-ev">{p.name}{p.required ? ' *' : ''}</code>)}
                          </div>
                        ) : null}
                        <div className="lbl">{t('developer.example')}</div>
                        <pre className="dev-pre" tabIndex={0}><code>{example}</code></pre>
                        <div className="small muted">{t('developer.response')}: <span className="mono">{o.response.status}</span></div>
                      </div>
                    </details>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        <h2 className="sec">{t('developer.scopes')}</h2>
        <p className="small muted" style={{ margin: 0, maxWidth: '80ch' }}>{t('developer.scopesHint')}</p>
        <div className="tablewrap">
          <table className="stable">
            <thead><tr><th>{t('developer.col.scope')}</th><th>{t('developer.col.summary')}</th><th>{t('developer.col.perms')}</th></tr></thead>
            <tbody>
              {API_SCOPES.map((s) => (
                <tr key={s}>
                  <th scope="row"><code className="mono">{s}</code></th>
                  <td className="small">{t('admin.api.scopeHints.' + s.replace(':', '_'))}</td>
                  <td className="small">{SCOPE_PERMISSIONS[s].map((p) => t('admin.permissions.' + permKey(p))).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="sec">{t('developer.errors.title')}</h2>
        <p className="small fg2" style={{ margin: 0, maxWidth: '80ch' }}>{t('developer.errors.text')}</p>

        <h2 className="sec">{t('developer.webhooksTitle')}</h2>
        <p className="small fg2" style={{ margin: 0, maxWidth: '80ch' }}>{t('developer.webhooksText')}</p>
        <div className="lbl">{t('developer.verify')} · Node.js</div>
        <pre className="dev-pre" tabIndex={0}><code>{NODE_VERIFY}</code></pre>
        <div className="lbl">{t('developer.verify')} · Python</div>
        <pre className="dev-pre" tabIndex={0}><code>{PY_VERIFY}</code></pre>
        <div className="lbl">{t('developer.events')}</div>
        <div className="chips">{EVENT_TYPES.map((e) => <code key={e} className="tag outline mono dev-ev">{e}</code>)}</div>
      </>
    )
  }

  async function Tokens() {
    const now = new Date()
    const scopes = allowedScopes(ctx.roleGrants)
    const tokens = await db.apiToken.findMany({ where: { orgId: ctx.org.id, createdById: ctx.user.id, personal: true }, orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], take: 50 })
    const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, ctx.locale)
    return (
      <>
        <section className="card" aria-labelledby="dev-new">
          <div className="card-head"><h2 id="dev-new">{t('developer.tokens.create')}</h2></div>
          <div className="card-body stack-sm">
            <p className="fg2" style={{ margin: 0, maxWidth: '80ch' }}>{t('developer.tokens.intro')}</p>
            {scopes.length ? (
              <SecretForm action={createPersonalTokenAction} submit={t('developer.tokens.submit')} intro={t('developer.tokens.once')} label={t('developer.tokens.token')} success="developer.tokens.created">
                <div className="form-grid">
                  <TextField label={t('developer.tokens.name')} name="name" required maxLength={80} placeholder={t('developer.tokens.namePlaceholder')} />
                  <Select label={t('developer.tokens.days')} name="days" defaultValue="30">
                    {TOKEN_DAYS.map((d) => <option key={d} value={String(d)}>{t('developer.tokens.daysN', { n: d })}</option>)}
                  </Select>
                </div>
                <fieldset>
                  <legend className="lbl">{t('developer.scopes')}</legend>
                  <div className="grid-3" style={{ gap: 4 }}>
                    {scopes.map((s) => <Checkbox key={s} name="scopes" value={s} label={<><code className="mono small">{s}</code> <span className="small muted">{t('admin.api.scopeHints.' + s.replace(':', '_'))}</span></>} />)}
                  </div>
                </fieldset>
              </SecretForm>
            ) : <div className="alert" role="status"><span className="grow">{t('developer.tokens.noScopes')}</span></div>}
          </div>
        </section>
        {tokens.length ? (
          <div className="tablewrap">
            <table className="stable">
              <thead><tr><th>{t('developer.col.name')}</th><th>{t('developer.scopes')}</th><th>{t('developer.col.expires')}</th><th>{t('developer.col.lastUsed')}</th><th>{t('developer.col.status')}</th><th><span className="sr-only">{t('admin.common.actions')}</span></th></tr></thead>
              <tbody>
                {tokens.map((k) => {
                  const st = tokenState(k, now)
                  return (
                    <tr key={k.id}>
                      <th scope="row">{k.name}</th>
                      <td><div className="chips">{k.scopes.map((s) => <code key={s} className="tag outline mono dev-ev">{s}</code>)}</div></td>
                      <td className="num nowrap">{k.expiresAt ? fmtDate(k.expiresAt, ctx.locale) : t('developer.tokens.unlimited')}</td>
                      <td className="num nowrap">{k.lastUsedAt ? rel(k.lastUsedAt) : <span className="muted">{t('developer.tokens.never')}</span>}</td>
                      <td><span className={'tag ' + (st === 'active' ? 'ok' : st === 'revoked' ? 'crit' : '')}>{t('developer.tokens.state.' + st)}</span></td>
                      <td className="right">{st === 'active' && <ActBtn action={revokePersonalTokenAction.bind(null, k.id)} className="btn sm danger" confirm="developer.tokens.revokeConfirm" context={<span><strong>{k.name}</strong> · {k.scopes.join(', ')}</span>} consequences={[t('admin.ux.revokeFinal')]}>{t('developer.tokens.revoke')}</ActBtn>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty title={t('developer.tokens.none')}>{t('developer.tokens.noneHint')}</Empty>}
      </>
    )
  }

  async function Webhooks() {
    const hooks = await db.webhook.findMany({ where: { orgId: ctx.org.id }, include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { createdAt: 'asc' } })
    const now = new Date()
    const rel = (d: Date) => fmtRel(d, { today: t('common.today'), yesterday: t('common.yesterday') }, now, ctx.locale)
    return (
      <>
        <p className="fg2" style={{ margin: 0, maxWidth: '80ch' }}>{t('developer.webhooksText')}</p>
        {hooks.length ? (
          <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
            {hooks.map((h) => {
              const d = h.deliveries[0]
              const ok = d?.status != null && d.status >= 200 && d.status < 300
              return (
                <li key={h.id}>
                  <div className="li" style={{ flexWrap: 'wrap' }}>
                    <div className="grow" style={{ minWidth: 200 }}>
                      <div className="mono ellipsis">{h.url}</div>
                      <div className="small muted">
                        {h.active ? t('admin.config.active') : t('admin.config.inactive')}
                        {d && <> · {t('developer.hooks.lastDelivery')}: {rel(d.createdAt)} <span className={'tag ' + (ok ? 'ok' : 'crit')}>{ok ? '✓ ' : '✕ '}{d.status ?? t('admin.webhooks.noResponse')}</span></>}
                      </div>
                    </div>
                    <ActBtn action={testWebhookAction.bind(null, h.id)} className="btn sm">{t('developer.hooks.test')}</ActBtn>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : <Empty title={t('developer.hooks.none')} />}
        <div><Link className="btn" href="/admin/integrations?tab=webhooks">{t('developer.hooks.manage')}</Link></div>
      </>
    )
  }
}
