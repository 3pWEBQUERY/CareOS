import 'server-only'
import { db } from '@/lib/db'
import type { Ctx } from '@/lib/context'
import { plainText } from '@/lib/markdown'
import { addDays } from '@/lib/time'
import { inAudience, roleKeysByUserIds } from '@/lib/audience'

/** Kategorien CareOS Docs (PRD §20). Schlüssel sind stabil, Anzeige über docs.cat.<key>. */
export const DOC_CATEGORIES = ['guideline', 'instruction', 'emergency', 'hygiene', 'form', 'checklist', 'hr', 'standard'] as const
export type DocCategory = (typeof DOC_CATEGORIES)[number]

export const CATEGORY_TONE: Record<string, string> = {
  guideline: 'accent', instruction: 'violet', emergency: 'crit', hygiene: 'ok', form: '', checklist: '', hr: 'outline', standard: 'accent',
}

/** Gültigkeit endet bald, wenn sie innerhalb dieser Tage abläuft. */
export const EXPIRY_WARN_DAYS = 30

export function validity(validUntil: Date | null, now = new Date()): 'none' | 'ok' | 'soon' | 'expired' {
  if (!validUntil) return 'none'
  if (validUntil < now) return 'expired'
  if (validUntil < addDays(now, EXPIRY_WARN_DAYS)) return 'soon'
  return 'ok'
}

export type VersionState = 'approved' | 'review' | 'draft'
export const versionState = (v: { approvedAt: Date | null; submittedAt: Date | null }): VersionState =>
  v.approvedAt ? 'approved' : v.submittedAt ? 'review' : 'draft'

/** Nächste Versionsnummer: kritisch = Hauptversion, sonst Nebenversion. */
export function nextVersion(current: string | null | undefined, critical: boolean) {
  if (!current) return '1.0'
  const m = /^(\d+)(?:\.(\d+))?/.exec(current)
  if (!m) return current + '.1'
  const major = Number(m[1])
  const minor = Number(m[2] ?? 0)
  return critical ? `${major + 1}.0` : `${major}.${minor + 1}`
}

/** Lädt ein Dokument der Organisation inkl. Versionen (neueste zuerst). */
export async function loadDoc(ctx: Ctx, id: string) {
  return db.document.findFirst({
    where: { id, orgId: ctx.org.id },
    include: { versions: { orderBy: { createdAt: 'desc' } } },
  })
}

/**
 * Benutzer, die das Dokument bestätigen müssen (aktive Mitarbeitende mit docs.read).
 * Mit Zielgruppe (Rollen-Schlüssel, PRD §45) nur Personen mit einer dieser Rollen.
 */
export async function ackAudience(orgId: string, audienceRoles: readonly string[] = []) {
  const rows = await db.roleAssignment.findMany({
    where: { role: { orgId, permissions: { has: 'docs.read' } }, user: { active: true, orgId } },
    select: { userId: true },
  })
  const ids = [...new Set(rows.map((r) => r.userId))]
  if (!audienceRoles.length) return ids
  const keys = await roleKeysByUserIds(ids)
  return ids.filter((id) => inAudience(audienceRoles, keys.get(id) ?? []))
}

// ── Suche ──

const STOP = new Set(
  ('zeige zeig mir mich die der das den dem des ein eine einen einem einer zur zum zu im in am an auf aus bei mit nach von vor für fuer ' +
    'und oder wie was wo wer welche welcher welches ist sind gibt es aktuelle aktuellen aktuell neue neuste neueste bitte finde suche ' +
    'show me the a an of to for in on and or what where which is are current latest please find ' +
    'montre moi la le les des du de un une pour et ou quelle quel est actuelle ' +
    'mostra mi il lo la le gli dei del di un una per e o quale è attuale').split(/\s+/),
)

export const norm = (s: string) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')

export function queryTerms(q: string) {
  return [...new Set(norm(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w)))]
}

const stem = (w: string) => (w.length > 5 ? w.replace(/(en|er|es|e|n|s)$/, '') : w)

export type SearchDoc = { id: string; title: string; tags: string[]; category: string; body: string }

/** Einfache Relevanz: Titel > Schlagworte > Kategorie > Volltext. 0 = kein Treffer. */
export function scoreDoc(d: SearchDoc, terms: string[], catLabel = '') {
  if (!terms.length) return 1
  const title = norm(d.title)
  const tags = d.tags.map(norm).join(' ')
  const cat = norm(d.category + ' ' + catLabel)
  const body = norm(d.body)
  let score = 0
  let matched = 0
  for (const t of terms) {
    const s = stem(t)
    let hit = 0
    if (title.includes(s)) hit += 6
    if (tags.includes(s)) hit += 4
    if (cat.includes(s)) hit += 2
    if (body.includes(s)) hit += 1 + Math.min(3, body.split(s).length - 2)
    if (hit) matched++
    score += hit
  }
  // Alle Begriffe sollen vorkommen; Teiltreffer zählen weniger.
  if (!matched) return 0
  return matched === terms.length ? score : score * (matched / terms.length) * 0.5
}

/** Textausschnitt rund um den ersten Treffer. */
export function snippet(body: string, terms: string[], len = 180) {
  const text = plainText(body)
  const n = norm(text)
  let pos = -1
  for (const t of terms) {
    const p = n.indexOf(stem(t))
    if (p >= 0 && (pos < 0 || p < pos)) pos = p
  }
  if (pos < 0) return text.slice(0, len) + (text.length > len ? ' …' : '')
  const start = Math.max(0, pos - 50)
  return (start > 0 ? '… ' : '') + text.slice(start, start + len) + (start + len < text.length ? ' …' : '')
}

// ── Zeilen-Diff ──

export type DiffLine = { op: 'same' | 'add' | 'del'; text: string }

/** Zeilenweiser Vergleich (LCS). Für sehr lange Texte vereinfachter Vergleich. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, '\n').split('\n')
  const b = after.replace(/\r\n?/g, '\n').split('\n')
  const n = a.length
  const m = b.length
  if (n * m > 4_000_000) {
    const setA = new Set(a)
    const setB = new Set(b)
    return [...a.filter((l) => !setB.has(l)).map((text) => ({ op: 'del' as const, text })), ...b.map((text) => ({ op: setA.has(text) ? ('same' as const) : ('add' as const), text }))]
  }
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: 'same', text: a[i] }); i++; j++ }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: 'del', text: a[i++] })
    else out.push({ op: 'add', text: b[j++] })
  }
  while (i < n) out.push({ op: 'del', text: a[i++] })
  while (j < m) out.push({ op: 'add', text: b[j++] })
  return out
}

/** Namen für eine Menge von Benutzer-IDs. */
export async function userNames(orgId: string, ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))]
  if (!uniq.length) return new Map<string, string>()
  const users = await db.user.findMany({ where: { orgId, id: { in: uniq } }, select: { id: true, firstName: true, lastName: true } })
  return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]))
}
