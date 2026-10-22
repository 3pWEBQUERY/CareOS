import 'server-only'
import type { Ctx } from '@/lib/context'
import type { Permission } from '@/lib/permissions'
import { ADMIN_SECTIONS } from '@/app/(app)/admin/sections'

/**
 * "Funktionen" für die globale Suche (PRD §24): Einstellungen und Bereiche, die man sonst über
 * mehrere Klicks erreicht. Statisch, nach Berechtigung gefiltert. Labels sind i18n-Schlüssel,
 * keywords helfen bei Synonymen (DE/FR/IT/EN, damit z. B. "MFA" oder "2FA" trifft).
 */
type Fn = { label: string; hint?: string; href: string; perm?: Permission; anyPrefix?: string; keywords?: string }

const FUNCTIONS: Fn[] = [
  { label: 'profile.mfa.title', hint: 'profile.security', href: '/profile#p-mfa', keywords: 'mfa 2fa totp zwei faktor authenticator double authentification autenticazione sicherheit security' },
  { label: 'profile.passkeys.title', hint: 'profile.security', href: '/profile#p-passkeys', keywords: 'passkey webauthn fido sicherheit security' },
  { label: 'profile.sessions.title', hint: 'profile.security', href: '/profile#p-sessions', keywords: 'sitzung geräte devices sessions abmelden logout' },
  { label: 'profile.password.title', hint: 'profile.security', href: '/profile#p-password', keywords: 'passwort password mot de passe kennwort' },
  { label: 'profile.appearance.title', hint: 'nav.profile', href: '/profile#p-appearance', keywords: 'sprache language langue lingua dunkel dark theme darstellung' },
  { label: 'schedule.tabs.mine', hint: 'nav.schedule', href: '/schedule', perm: 'schedule.read', keywords: 'dienstplan schedule planning dienste' },
  { label: 'schedule.tabs.open', hint: 'nav.schedule', href: '/schedule?view=open', perm: 'schedule.read', keywords: 'dienstplan offene dienste' },
  { label: 'schedule.tabs.absences', hint: 'nav.schedule', href: '/schedule?view=absences', perm: 'schedule.read', keywords: 'ferien urlaub abwesenheit krank' },
  { label: 'schedule.tabs.swaps', hint: 'nav.schedule', href: '/schedule?view=swaps', perm: 'schedule.read', keywords: 'tausch swap dienstplan' },
  { label: 'schedule.tabs.team', hint: 'nav.schedule', href: '/schedule?view=team', perm: 'schedule.manage', keywords: 'dienstplan planung teamplanung' },
  { label: 'schedule.tabs.coverage', hint: 'nav.schedule', href: '/schedule?view=coverage', perm: 'schedule.manage', keywords: 'besetzung qualifikation dienstplan' },
  { label: 'learn.tabs.certificates', hint: 'nav.learn', href: '/learn/certificates', perm: 'learn.read', keywords: 'zertifikat nachweis' },
  { label: 'learn.tabs.compliance', hint: 'nav.learn', href: '/learn/compliance', perm: 'learn.manage', keywords: 'matrix schulung pflichtschulung' },
  { label: 'docs.new', hint: 'nav.docs', href: '/docs', perm: 'docs.manage', keywords: 'weisung standard richtlinie' },
  { label: 'nav.medround', hint: 'common.palette.groupAction', href: '/tasks/medround', perm: 'resident.medication.administer', keywords: 'medikamente abgabe runde' },
  { label: 'visit.title', hint: 'common.palette.groupAction', href: '/tasks/visit', perm: 'resident.read', keywords: 'visite arzt arztvisite anordnung fragen visite médicale visita medica round doctor' },
  { label: 'common.quick.incident', hint: 'nav.quality', href: '/quality/new', perm: 'quality.report', keywords: 'sturz ereignis meldung cirs vorfall' },
  { label: 'common.palette.fn.newPost', hint: 'nav.team', href: '/team/new', perm: 'team.post', keywords: 'mitteilung post news' },
  { label: 'common.palette.fn.handoverSince', hint: 'nav.handover', href: '/handover?since=1', perm: 'handover.read', keywords: 'übergabe rapport seit letztem dienst' },
]

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Treffer unter den Funktionen, inklusive Admin-Bereichen, für die Suchanfrage q. */
export function searchFunctions(ctx: Ctx, q: string, limit = 6) {
  const { t } = ctx
  const needle = norm(q.trim())
  const out: { label: string; hint?: string; href: string }[] = []
  const admin = ADMIN_SECTIONS.filter((s) => ctx.can(s.perm)).map((s) => ({
    label: t('admin.nav.' + s.key), hint: `${t('nav.admin')} · ${t('admin.nav.' + s.key + 'Hint')}`, href: s.href, keywords: 'admin ' + s.key,
  }))
  const fns = FUNCTIONS.filter((f) => !f.perm || ctx.can(f.perm)).map((f) => ({ label: t(f.label), hint: f.hint ? t(f.hint) : undefined, href: f.href, keywords: f.keywords ?? '' }))
  for (const f of [...fns, ...admin]) {
    if (!norm(`${f.label} ${f.hint ?? ''} ${f.keywords}`).includes(needle)) continue
    out.push({ label: f.label, hint: f.hint, href: f.href })
    if (out.length >= limit) break
  }
  return out
}
