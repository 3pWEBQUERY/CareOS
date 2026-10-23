import type { Locale } from '@/i18n/core'
import { INTL_LOCALE } from '@/i18n/core'
import { hm, sameDay, addDays } from '@/lib/time'
import { getPortalCtx, portalAudit, type PortalCtx } from '@/lib/portal/context'
import { Empty } from '@/components/ui/Empty'

/** «Montag, 26. Oktober» bzw. «Heute» / «Morgen». */
export function fmtDay(d: Date, locale: Locale, t: PortalCtx['t'], now = new Date()) {
  if (sameDay(d, now)) return t('portal.time.today')
  if (sameDay(d, addDays(now, 1))) return t('portal.time.tomorrow')
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'long', day: 'numeric', month: 'long' }).format(d)
}
export const fmtWhen = (d: Date, locale: Locale, t: PortalCtx['t']) => `${fmtDay(d, locale, t)}, ${hm(d)}`
/** Langes Datum für den Kopf von «Mein Tag»: «Freitag, 23. Oktober». */
export const fmtLongDate = (d: Date, locale: Locale) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'long', day: 'numeric', month: 'long' }).format(d)
export const fmtShortDate = (d: Date, locale: Locale) => new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)

/** Lädt den Portal-Kontext für eine Seite und protokolliert den Zugriff (PRD §36: jeder Portalzugriff im Audit). */
export async function portalPage(page: string) {
  const p = await getPortalCtx()
  if (p.current) await portalAudit(p, { action: 'portal.view', entityType: 'Resident', entityId: p.current.residentId, context: { page, accessId: p.current.id } })
  return p
}

export function PortalHead({ label, kicker, title, sub, children }: { label?: string; kicker?: string; title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="portal-head">
      <div className="grow">
        {label && <span className="lbl">{label}</span>}
        {kicker && <p className="portal-kicker">{kicker}</p>}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="portal-head-actions">{children}</div>}
    </div>
  )
}

/** Kein aktiver Zugang (widerrufen, Modul aus, Person ausgetreten) oder Bereich nicht freigegeben. */
export function NoAccess({ p, grant }: { p: PortalCtx; grant?: boolean }) {
  return (
    <>
      <PortalHead title={grant ? p.t('portal.empty.grantTitle') : p.t('portal.empty.noAccessTitle')} />
      <Empty title={grant ? p.t('portal.empty.grant') : p.t('portal.empty.noAccess')}>{p.t('portal.empty.contact')}</Empty>
    </>
  )
}

/**
 * Bezeichnung eines Termins im Bewohnerportal (einfache Sprache): Therapieart, sonst Titel (nur nicht klinische
 * Arten, policy.ts), sonst die Art. `meta` ergänzt Ort und – wenn ein Titel steht – die Art.
 */
export function selfAppointmentText(a: { kind: string; title: string | null; discipline: string | null; place: string | null }, t: PortalCtx['t']) {
  const kind = t('residentPortal.kinds.' + a.kind)
  const label = a.discipline ? t('residentPortal.disciplines.' + a.discipline) : a.title ?? kind
  const meta = [a.title && !a.discipline ? kind : null, a.place].filter(Boolean).join(' · ')
  return { label, meta }
}
