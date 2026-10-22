import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { ForbiddenError, getCtx, residentInScope, type Ctx } from '@/lib/context'
import type { Permission } from '@/lib/permissions'

/** Lädt die Akte für eine Seite (404, wenn ausserhalb des Zugriffsbereichs) und liefert Berechtigungsprüfung im Bereich der Person. */
export async function pageResident(id: string, perm: Permission = 'resident.read') {
  const ctx = await getCtx()
  const r = await residentInScope(ctx, id, perm)
  if (!r) notFound()
  const scope = { unitId: r.unitId, locationId: r.unit.locationId }
  const can = (p: Permission) => ctx.can(p, scope)
  return { ctx, r, scope, can }
}

/** Für Server Actions: Person laden und Berechtigung im Bereich prüfen, sonst ForbiddenError. */
export async function actionResident(id: string, perm: Permission) {
  const ctx = await getCtx()
  const r = await residentInScope(ctx, id, perm)
  if (!r) throw new ForbiddenError(perm)
  const can = (p: Permission) => ctx.can(p, { unitId: r.unitId, locationId: r.unit.locationId })
  return { ctx, r, can }
}

/** Namen der Mitarbeitenden (nur eigene Organisation) für Autorenzeilen. */
export async function userNames(ctx: Ctx, ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  if (!uniq.length) return new Map<string, { short: string; full: string; initials: string }>()
  const users = await db.user.findMany({ where: { id: { in: uniq }, orgId: ctx.org.id }, select: { id: true, firstName: true, lastName: true, initials: true, jobTitle: true } })
  return new Map(users.map((u) => [u.id, {
    short: `${u.firstName.charAt(0)}. ${u.lastName}`,
    full: `${u.firstName.charAt(0)}. ${u.lastName}${u.jobTitle ? ', ' + u.jobTitle : ''}`,
    initials: u.initials,
  }]))
}

export const residentName = (r: { firstName: string; lastName: string }) => `${r.lastName} ${r.firstName}`

/** Kategorien der Verlaufseinträge mit Tag-Farbe wie im Entwurf. */
export const OBS_CATEGORIES = ['care', 'observation', 'physician', 'relatives', 'incident', 'handover'] as const
export const OBS_TONE: Record<string, string> = { care: 'accent', observation: 'warn', physician: 'violet', relatives: '', incident: 'crit', handover: 'ok' }

/** Aufgabenkategorien (in der DB als Klartext gespeichert) → i18n-Schlüssel und Tag-Farbe. */
export const TASK_CATEGORIES: { value: string; key: string; tone: string }[] = [
  { value: 'Grundpflege', key: 'basic', tone: '' },
  { value: 'Behandlungspflege', key: 'treatment', tone: 'accent' },
  { value: 'Medikation', key: 'medication', tone: 'violet' },
  { value: 'Ernährung', key: 'nutrition', tone: '' },
  { value: 'Mobilität', key: 'mobility', tone: '' },
  { value: 'Überwachung', key: 'monitoring', tone: 'warn' },
  { value: 'Aktivierung', key: 'activation', tone: 'ok' },
  { value: 'Assessment', key: 'assessment', tone: 'accent' },
  { value: 'Qualität', key: 'quality', tone: 'crit' },
  { value: 'Organisation', key: 'organisation', tone: '' },
]
export function taskCategory(t: (k: string) => string, value: string) {
  const c = TASK_CATEGORIES.find((x) => x.value === value)
  return { label: c ? t('chart.taskCat.' + c.key) : value, tone: c?.tone ?? '' }
}

export const splitList = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 30)

const titleResident = cache(async (id: string) => residentInScope(await getCtx(), id))

/**
 * Seitentitel einer Akte in der Sprache der Person: «Huber Margrit · Verlauf» (PRD §53).
 * `detail` ergänzt den Datensatz einer Detailseite (z. B. Wundlokalisation).
 */
export async function residentTitle(id: string, tab?: string, detail?: (r: NonNullable<Awaited<ReturnType<typeof titleResident>>>) => Promise<string | null | undefined>) {
  const { t } = await getCtx()
  const r = await titleResident(id)
  const tabLabel = tab ? t('residents.tabs.' + tab) : null
  if (!r) return { title: tabLabel ?? t('nav.residents') }
  const extra = detail ? await detail(r) : null
  return { title: [residentName(r), tabLabel, extra].filter(Boolean).join(' · ') }
}
