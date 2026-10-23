import Link from 'next/link'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { EXTERNAL_PHYSICIAN } from '@/lib/permissions'
import { INVITE_DAYS } from '@/lib/invites'
import { physicianAccounts } from '@/lib/md/physicians'
import { fmtDate } from '@/lib/time'
import { Empty, Forbidden } from '@/components/ui/Empty'
import { AdminHead } from '../Head'
import { CreateExternal } from './PhysicianClient'

export async function generateMetadata() {
  return { title: (await getCtx()).t('md.admin.title') }
}

/** Administration › Ärztinnen und Ärzte (PRD §60, §40): interne und externe Konten, Zuordnungen, zweiter Faktor. */
export default async function PhysiciansPage() {
  const ctx = await getCtx()
  const { t, locale } = ctx
  if (!ctx.can('admin.users')) return <Forbidden text={t('common.notAllowed')} />
  const now = new Date()
  const users = await physicianAccounts(ctx.org.id)
  const [counts, passkeys] = await Promise.all([
    db.residentPhysician.groupBy({ by: ['userId'], where: { orgId: ctx.org.id, userId: { in: users.map((u) => u.id) }, from: { lte: now }, OR: [{ until: null }, { until: { gt: now } }] }, _count: { _all: true } }),
    db.passkey.groupBy({ by: ['userId'], where: { userId: { in: users.map((u) => u.id) } }, _count: { _all: true } }),
  ])
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <AdminHead section={t('admin.title')} title={t('md.admin.title')} sub={t('md.admin.sub')}>
        <CreateExternal days={INVITE_DAYS} />
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          {users.length ? (
            <div className="tablewrap">
              <table className="stable">
                <thead>
                  <tr>
                    <th>{t('md.admin.col.name')}</th>
                    <th>{t('md.admin.col.kind')}</th>
                    <th className="right">{t('md.admin.col.patients')}</th>
                    <th>{t('md.admin.col.mfa')}</th>
                    <th>{t('md.admin.col.lastLogin')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const mfa = u.mfaEnabled || passkeys.some((p) => p.userId === u.id)
                    const ext = u.kind === EXTERNAL_PHYSICIAN
                    return (
                      <tr key={u.id}>
                        <td>
                          <Link className="linkbtn" href={`/admin/physicians/${u.id}`}>{u.lastName} {u.firstName}</Link>
                          <div className="small muted">{[u.jobTitle, u.email].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td><span className={'tag ' + (ext ? 'accent' : 'outline')}>{t(ext ? 'md.admin.kind.external' : 'md.admin.kind.internal')}</span>{!u.active && <> <span className="tag">{t('md.admin.inactive')}</span></>}</td>
                        <td className="right num">{counts.find((c) => c.userId === u.id)?._count._all ?? 0}</td>
                        <td>{mfa ? <span className="tag ok"><span aria-hidden="true">✓ </span>{t('md.admin.mfaOn')}</span> : <span className={'tag ' + (ext ? 'crit' : 'warn')}>{t('md.admin.mfaOff')}</span>}</td>
                        <td className="small nowrap">{u.lastLoginAt ? fmtDate(u.lastLoginAt, locale) : <span className="muted">{t('md.admin.never')}</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <Empty title={t('md.admin.none')} />}
        </div>
      </div>
    </main>
  )
}
