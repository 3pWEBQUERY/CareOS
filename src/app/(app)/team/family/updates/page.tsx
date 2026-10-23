import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { storageConfigured } from '@/lib/env'
import { dateKey, fmtRel, fmtDate } from '@/lib/time'
import { portalEnabled } from '@/lib/portal/module'
import { normalizeAudience } from '@/lib/portal/policy'
import { FamilyHead, ModuleOff } from '../Head'
import { familyUnits, staffName } from '../lib'
import { DeleteUpdate, UpdateForm } from './UpdateForm'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('portal.team.tabs.updates') }
}

/** Mitteilungen für Angehörige: eigene Kategorie, nie aus Verlauf oder Team-Mitteilungen. */
export default async function FamilyUpdates() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!portalEnabled(ctx.org)) return <ModuleOff ctx={ctx} />
  if (!ctx.can('portal.manage')) return <Forbidden text={t('common.notAllowed')} />
  const units = familyUnits(ctx, 'portal.manage')
  const unitIds = units.map((u) => u.id)
  const orgWide = ctx.grants.some((g) => g.permissions.includes('portal.manage') && !g.unitId && !g.locationId)
  const [residents, updates] = await Promise.all([
    db.resident.findMany({ where: { orgId: ctx.org.id, unitId: { in: unitIds }, status: { in: ['active', 'absent'] }, anonymisedAt: null }, select: { id: true, firstName: true, lastName: true, room: { select: { number: true } }, unit: { select: { name: true } } }, orderBy: { lastName: 'asc' } }),
    db.portalUpdate.findMany({
      where: { orgId: ctx.org.id, OR: [{ unitId: { in: unitIds } }, ...(orgWide ? [{ unitId: null }] : [])] },
      include: { resident: { select: { firstName: true, lastName: true } } },
      orderBy: { publishedAt: 'desc' },
      take: 60,
    }),
  ])
  const authors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(updates.map((u) => u.authorId))] }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true } })).map((u) => [u.id, staffName(u)]))
  const unitName = new Map(ctx.units.map((u) => [u.id, u.name]))
  const now = new Date()
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <FamilyHead ctx={ctx} tab="updates" title={t('portal.team.updatesTitle')} sub={t('portal.team.updatesSub')} />
      <div className="scroll">
        <div className="tabpanel">
          <div className="portal-team-detail">
            <section className="card" aria-labelledby="fu-list">
              <div className="card-head"><h2 id="fu-list">{t('portal.team.published')}</h2><span className="pill">{updates.length}</span></div>
              {updates.length ? (
                <ul className="list">
                  {updates.map((u) => {
                    const expired = !!u.expiresAt && u.expiresAt < now
                    return (
                      <li key={u.id}><div className="li" style={{ alignItems: 'flex-start' }}>
                        <div className="grow stack-sm" style={{ minWidth: 0 }}>
                          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                            <strong>{u.title}</strong>
                            <span className="tag outline">{u.resident ? `${u.resident.lastName} ${u.resident.firstName}` : u.unitId ? unitName.get(u.unitId) ?? '–' : t('portal.team.scopeOrg')}</span>
                            {u.audience !== 'family' && <span className="tag accent">{t('residentPortal.team.audiences.' + normalizeAudience(u.audience))}</span>}
                            {expired && <span className="tag">{t('portal.team.expired')}</span>}
                            {u.fileIds.length > 0 && <span className="small muted">{t('portal.team.attachments', { n: u.fileIds.length })}</span>}
                          </div>
                          <p className="small fg2 portal-clamp" style={{ margin: 0 }}>{u.body}</p>
                          <div className="small muted">{authors.get(u.authorId) ?? '–'} · {fmtRel(u.publishedAt, { today: t('common.today'), yesterday: t('common.yesterday') }, now, locale)}{u.expiresAt && !expired ? ' · ' + t('portal.team.until', { date: fmtDate(u.expiresAt, locale) }) : ''}</div>
                        </div>
                        <DeleteUpdate id={u.id} title={u.title} />
                      </div></li>
                    )
                  })}
                </ul>
              ) : <div className="card-body small muted">{t('portal.team.noUpdates')}</div>}
            </section>
            <section className="card" aria-labelledby="fu-new">
              <div className="card-head"><h2 id="fu-new">{t('portal.team.newUpdate')}</h2></div>
              <div className="card-body">
                <UpdateForm
                  units={units.map((u) => ({ value: u.id, label: u.name }))}
                  defaultUnit={ctx.unit && unitIds.includes(ctx.unit.id) ? ctx.unit.id : unitIds[0] ?? ''}
                  residents={residents.map((r) => ({ value: r.id, label: `${r.lastName} ${r.firstName}`, hint: [r.room?.number && `${t('residents.banner.room')} ${r.room.number}`, r.unit.name].filter(Boolean).join(' · '), keywords: r.room?.number ?? '' }))}
                  orgWide={orgWide}
                  storage={storageConfigured()}
                  today={dateKey(now)}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
