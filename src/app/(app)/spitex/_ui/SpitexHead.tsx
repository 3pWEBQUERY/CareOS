import Link from 'next/link'
import type { Ctx } from '@/lib/context'
import { spitexUnits } from '@/lib/spitex-data'

type Tab = 'dispatch' | 'tour' | 'clients' | 'proof'

/** Kopf und Register des Spitex-Moduls. Register nur mit dem jeweiligen Recht in einem Einsatzgebiet. */
export function SpitexHead({ ctx, current, title, where, actions, unitId }: { ctx: Ctx; current: Tab; title: string; where?: string | null; actions?: React.ReactNode; unitId?: string | null }) {
  const { t } = ctx
  const q = unitId ? '?u=' + unitId : ''
  const tabs: [Tab, string, string, boolean][] = [
    ['dispatch', '/spitex' + q, t('spitex.tabs.dispatch'), spitexUnits(ctx, 'spitex.read').length > 0],
    ['tour', '/spitex/tour', t('spitex.tabs.tour'), spitexUnits(ctx, 'spitex.document').length > 0],
    ['clients', '/spitex/clients' + q, t('spitex.tabs.clients'), spitexUnits(ctx, 'spitex.read').length > 0],
    ['proof', '/spitex/proof' + q, t('spitex.tabs.proof'), spitexUnits(ctx, 'spitex.read').length > 0],
  ]
  return (
    <>
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <span className="lbl">{where ? t('spitex.label', { where }) : t('nav.spitex')}</span>
          <h1>{title}</h1>
        </div>
        {actions && <div className="row head-actions">{actions}</div>}
      </div>
      <nav className="tabs no-print" aria-label={t('nav.spitex')}>
        {tabs.filter((x) => x[3]).map(([k, href, label]) => <Link key={k} href={href} aria-current={k === current ? 'page' : undefined}>{label}</Link>)}
      </nav>
    </>
  )
}

/** Auswahl des Einsatzgebiets, wenn es mehrere gibt (Links, damit der Bereich der Topbar unberührt bleibt). */
export function UnitSeg({ ctx, units, current, base, extra = '' }: { ctx: Ctx; units: { id: string; name: string; shortName: string | null }[]; current: string; base: string; extra?: string }) {
  if (units.length < 2) return null
  return (
    <nav className="seg seg-x" aria-label={ctx.t('spitex.areas')}>
      {units.map((u) => <Link key={u.id} href={`${base}?u=${u.id}${extra}`} aria-current={u.id === current ? 'page' : undefined}>{u.shortName ?? u.name}</Link>)}
    </nav>
  )
}
