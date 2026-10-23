import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { dateKey, fmtDate } from '@/lib/time'
import { portalEnabled } from '@/lib/portal/module'
import { accessState, isShareableFileCategory, normalizeGrants, portalSettings } from '@/lib/portal/policy'
import { FamilyHead, ModuleOff } from '../Head'
import { familyUnits } from '../lib'
import { AccessActions, PortalSettingsForm, type FileRow } from './AccessActions'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('portal.team.tabs.accounts') }
}

const TONE: Record<string, string> = { invited: 'accent', expired: 'warn', active: 'ok', revoked: '', locked: 'crit' }
const STATES = ['all', 'active', 'invited', 'locked', 'revoked'] as const

/** Übersicht der Portal-Zugänge: Status, Freigaben, Einwilligung; Freigaben ändern, Dateien teilen, sperren, widerrufen. */
export default async function FamilyAccounts({ searchParams }: { searchParams: Promise<{ resident?: string; state?: string }> }) {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!portalEnabled(ctx.org)) return <ModuleOff ctx={ctx} />
  if (!ctx.can('portal.manage') && !ctx.can('portal.respond')) return <Forbidden text={t('common.notAllowed')} />
  const sp = await searchParams
  const state = (STATES as readonly string[]).includes(sp.state ?? '') ? sp.state! : 'all'
  const units = familyUnits(ctx).concat(familyUnits(ctx, 'portal.manage')).filter((u, i, a) => a.findIndex((x) => x.id === u.id) === i)
  const rows = await db.portalAccess.findMany({
    where: { orgId: ctx.org.id, resident: { orgId: ctx.org.id, unitId: { in: units.map((u) => u.id) } }, ...(sp.resident ? { residentId: sp.resident } : {}) },
    include: {
      account: { select: { id: true, name: true, email: true, lockedAt: true, lastLoginAt: true, mfaEnabled: true } },
      resident: { select: { id: true, firstName: true, lastName: true, unitId: true, room: { select: { number: true } }, unit: { select: { name: true, locationId: true } } } },
    },
    orderBy: [{ resident: { lastName: 'asc' } }, { createdAt: 'asc' }],
    take: 500,
  })
  const list = rows.map((a) => ({ ...a, state: accessState(a, a.account) })).filter((a) => state === 'all' || a.state === state || (state === 'invited' && a.state === 'expired'))
  const resIds = [...new Set(list.map((a) => a.residentId))]
  const files = resIds.length ? await db.residentFile.findMany({ where: { residentId: { in: resIds }, file: { orgId: ctx.org.id } }, select: { id: true, residentId: true, title: true, category: true, portalShared: true }, orderBy: { createdAt: 'desc' } }) : []
  const filesBy = new Map<string, FileRow[]>()
  for (const f of files) filesBy.set(f.residentId, [...(filesBy.get(f.residentId) ?? []), { id: f.id, title: f.title, category: f.category, shared: f.portalShared, shareable: isShareableFileCategory(f.category) }])
  const filterRes = sp.resident ? rows.find((r) => r.residentId === sp.resident)?.resident : null
  const s = portalSettings(ctx.org.settings)
  const today = dateKey(new Date())
  const q = (st: string) => '/team/family/accounts?' + new URLSearchParams({ ...(st !== 'all' ? { state: st } : {}), ...(sp.resident ? { resident: sp.resident } : {}) }).toString()
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <FamilyHead ctx={ctx} tab="accounts" title={t('portal.team.accountsTitle')} sub={t('portal.team.accountsSub')} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <nav className="chips" aria-label={t('common.filter')}>
              {STATES.map((x) => <Link key={x} className="chip" scroll={false} href={q(x)} aria-current={state === x ? 'page' : undefined}>{t('portal.team.states.' + x)}</Link>)}
            </nav>
            {filterRes && <Link className="chip" href="/team/family/accounts" aria-label={t('portal.team.clearFilter')}>{filterRes.lastName} {filterRes.firstName} ×</Link>}
          </div>
          {list.length ? (
            <section className="card" aria-label={t('portal.team.tabs.accounts')}>
              <ul className="list">
                {list.map((a) => {
                  const r = a.resident
                  const context = `${r.lastName} ${r.firstName} · ${a.account?.name ?? a.inviteName}`
                  const canManage = ctx.can('portal.manage', { unitId: r.unitId, locationId: r.unit.locationId })
                  return (
                    <li key={a.id}><div className="li" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div className="grow stack-sm" style={{ minWidth: 'min(100%, 260px)' }}>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <strong>{a.account?.name ?? a.inviteName}</strong>
                          <span className={'tag ' + TONE[a.state]}>{t('portal.state.' + a.state)}</span>
                          {a.role === 'legal_rep' && <span className="tag violet">{t('portal.roles.legal_rep')}</span>}
                          {a.account?.mfaEnabled && <span className="tag outline">{t('portal.team.mfa')}</span>}
                        </div>
                        <div className="small">
                          <Link href={`/residents/${r.id}/contacts`}>{r.lastName} {r.firstName}</Link>
                          <span className="muted">{r.room ? ` · ${t('residents.banner.room')} ${r.room.number}` : ''} · {r.unit.name}</span>
                        </div>
                        <div className="small fg2">{normalizeGrants(a.grants).map((g) => t('portal.grants.' + g)).join(' · ') || '–'}</div>
                        <div className="small muted">
                          {t('portal.contact.consent', { name: a.consentName, date: fmtDate(a.consentAt, locale), by: t('portal.consentBy.' + a.consentBy) })}
                          {a.account?.lastLoginAt && ' · ' + t('portal.contact.lastLogin', { date: fmtDate(a.account.lastLoginAt, locale) })}
                          {a.revokedAt && ' · ' + t('portal.team.revokedAt', { date: fmtDate(a.revokedAt, locale) })}
                        </div>
                      </div>
                      <AccessActions
                        access={{ id: a.id, accountId: a.accountId, grants: normalizeGrants(a.grants), consentScope: normalizeGrants(a.consentScope), locked: !!a.account?.lockedAt, revoked: !!a.revokedAt, consentName: a.consentName }}
                        context={context}
                        files={filesBy.get(a.residentId) ?? []}
                        today={today}
                        canManage={canManage}
                      />
                    </div></li>
                  )
                })}
              </ul>
            </section>
          ) : <div className="empty"><strong>{t('portal.team.noAccounts')}</strong><span className="small">{t('portal.team.noAccountsHint')}</span></div>}

          {ctx.can('admin.config') && (
            <section className="card" aria-labelledby="fa-settings">
              <div className="card-head"><h2 id="fa-settings">{t('portal.team.settings')}</h2></div>
              <div className="card-body"><PortalSettingsForm defaults={s.defaultGrants} lead={s.visitLeadHours} maxDays={s.visitMaxDays} /></div>
            </section>
          )}
        </div>
      </div>
    </main>
  )
}
