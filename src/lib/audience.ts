import 'server-only'
import { db } from '@/lib/db'

/**
 * Rollenbasierte Zielgruppen für Mitteilungen und Dokumente (PRD §45 «Zielgruppen»).
 * Eine Zielgruppe ist eine Liste von Rollen-Schlüsseln; leer = alle (bisheriges Verhalten).
 */

/** Gehört eine Person mit diesen Rollen zur Zielgruppe? */
export const inAudience = (audience: readonly string[], roleKeys: Iterable<string>) => {
  if (!audience.length) return true
  for (const k of roleKeys) if (audience.includes(k)) return true
  return false
}

/** Rollen der Organisation zur Auswahl (Schlüssel + Name), sortiert nach Name. */
export async function roleOptions(orgId: string) {
  return db.role.findMany({ where: { orgId }, select: { key: true, name: true }, orderBy: { name: 'asc' } })
}

/** Nur gültige Rollen-Schlüssel der Organisation übernehmen (Formularwerte sind nicht vertrauenswürdig). */
export async function parseAudience(orgId: string, values: FormDataEntryValue[]) {
  const wanted = [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v))]
  if (!wanted.length) return []
  const valid = new Set((await roleOptions(orgId)).map((r) => r.key))
  return wanted.filter((k) => valid.has(k)).slice(0, 30)
}

/** Rollen-Schlüssel je Person (alle Zuweisungen, unabhängig vom Bereich). */
export async function roleKeysByUserIds(userIds: string[]) {
  const rows = userIds.length ? await db.roleAssignment.findMany({ where: { userId: { in: userIds } }, select: { userId: true, role: { select: { key: true } } } }) : []
  const out = new Map<string, Set<string>>()
  for (const r of rows) out.set(r.userId, (out.get(r.userId) ?? new Set()).add(r.role.key))
  return out
}

/** Anzeigenamen der Rollen einer Zielgruppe (für Tags «Zielgruppe: …»). */
export async function audienceNames(orgId: string, audience: readonly string[]) {
  if (!audience.length) return []
  const roles = await db.role.findMany({ where: { orgId, key: { in: [...audience] } }, select: { key: true, name: true } })
  return audience.map((k) => roles.find((r) => r.key === k)?.name ?? k)
}
