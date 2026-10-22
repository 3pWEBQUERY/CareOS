/**
 * Benachrichtigungen dienstbewusst und je Art einstellbar (PRD §25) – reine Logik, testbar.
 *
 * Empfängerauswahl für klinische Bereichsmeldungen (z. B. auffälliger Vitalwert an alle mit Leserecht im Bereich):
 * 1. Wer im Dienstplan steht, erhält sie nur während des eigenen Dienstes in diesem Bereich (±15 Min. Übergabe).
 *    Personen ohne Dienstplanung (Leitung, PDL, QM) erhalten sie weiterhin; genehmigte Abwesenheit schliesst aus.
 * 2. Ist niemand aus dem Bereich im Dienst, geht die Meldung an die Stellvertretung:
 *    zuerst Berechtigte, die im selben Standort Dienst haben (z. B. Nachtdienst für mehrere Wohngruppen),
 *    sonst die Bereichsleitung (schedule.manage), sonst an alle ursprünglichen Empfangenden (nie verlieren).
 * Persönliche Meldungen (eine empfangende Person, z. B. zugewiesene Aufgabe) werden nicht gefiltert.
 */
import { isClinicalNotification } from './push-shared'

export const NOTIFY_CATEGORIES = ['clinical', 'task', 'schedule', 'team', 'chat', 'learn', 'docs', 'security', 'other'] as const
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number]
/** In der App immer sichtbar (Patientensicherheit, Sicherheit); nur Push ist abschaltbar. */
export const LOCKED_IN_APP: NotifyCategory[] = ['clinical', 'task', 'security']

export function categoryOf(kind: string, href?: string | null): NotifyCategory {
  const is = (p: string) => kind === p || kind.startsWith(p + '.')
  if (is('security')) return 'security'
  if (kind === 'task' || kind === 'task.assigned') return 'task'
  if (is('schedule')) return 'schedule'
  if (is('post') || is('ack')) return 'team'
  if (is('chat')) return href && isClinicalNotification(kind, href) ? 'clinical' : 'chat'
  if (is('learn')) return 'learn'
  if (is('docs') || is('document')) return 'docs'
  if (isClinicalNotification(kind, href)) return 'clinical'
  return 'other'
}

export type CategoryPref = { app: boolean; push: boolean }
export type NotifyPrefs = { kinds: Record<NotifyCategory, CategoryPref>; quietOffDuty: boolean }

export const DEFAULT_PREFS: NotifyPrefs = {
  kinds: Object.fromEntries(NOTIFY_CATEGORIES.map((c) => [c, { app: true, push: true }])) as Record<NotifyCategory, CategoryPref>,
  quietOffDuty: false,
}

/** User.notificationPrefs (Json) robust lesen; gesperrte Arten bleiben in der App immer an. */
export function normalizePrefs(input: unknown): NotifyPrefs {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const kinds = src.kinds && typeof src.kinds === 'object' ? (src.kinds as Record<string, unknown>) : {}
  const out: NotifyPrefs = { kinds: { ...DEFAULT_PREFS.kinds }, quietOffDuty: src.quietOffDuty === true }
  for (const c of NOTIFY_CATEGORIES) {
    const v = kinds[c] && typeof kinds[c] === 'object' ? (kinds[c] as Record<string, unknown>) : {}
    out.kinds[c] = {
      app: LOCKED_IN_APP.includes(c) ? true : v.app !== false,
      push: v.push !== false,
    }
  }
  return out
}

/** In-App-Zustellung nach Einstellung: kritische Meldungen und gesperrte Arten immer. */
export function wantsInApp(prefs: NotifyPrefs, category: NotifyCategory, priority: string) {
  if (priority === 'critical' || LOCKED_IN_APP.includes(category)) return true
  return prefs.kinds[category].app
}

/** Push nach Einstellung: Art erlaubt und (falls gewünscht) nur während des Dienstes. */
export function wantsPush(prefs: NotifyPrefs, category: NotifyCategory, duty: { planned: boolean; onDuty: boolean }) {
  if (!prefs.kinds[category].push) return false
  if (prefs.quietOffDuty && duty.planned && !duty.onDuty) return false
  return true
}

export type DutyState = {
  /** Im Dienst in diesem Bereich */
  onDutyUnit: Set<string>
  /** Im Dienst in einem anderen Bereich desselben Standorts */
  onDutyNearby: Set<string>
  /** Im Dienstplan geführt (Dienste in den letzten/nächsten 14 Tagen) */
  planned: Set<string>
  /** Genehmigte Abwesenheit heute */
  absent: Set<string>
  /** Bereichsleitung (schedule.manage im Bereich) */
  leads: string[]
}

export type Selection = { userIds: string[]; mode: 'duty' | 'nearby' | 'leads' | 'all' | 'personal' }

export function selectRecipients(candidates: string[], s: DutyState): Selection {
  const ids = [...new Set(candidates)]
  if (ids.length <= 1) return { userIds: ids, mode: 'personal' }
  const present = ids.filter((u) => !s.absent.has(u))
  // Ohne Dienstplanung im Bereich (keine der Personen geplant): alle Anwesenden.
  if (!present.some((u) => s.planned.has(u))) return { userIds: present.length ? present : ids, mode: 'all' }
  const keep = present.filter((u) => s.onDutyUnit.has(u) || !s.planned.has(u))
  if (keep.some((u) => s.onDutyUnit.has(u))) return { userIds: keep, mode: 'duty' }
  const nearby = present.filter((u) => s.onDutyNearby.has(u))
  if (nearby.length) return { userIds: [...new Set([...keep, ...nearby])], mode: 'nearby' }
  const leads = s.leads.filter((u) => !s.absent.has(u))
  if (leads.length) return { userIds: [...new Set([...keep, ...leads])], mode: 'leads' }
  return { userIds: present.length ? present : ids, mode: 'all' }
}
