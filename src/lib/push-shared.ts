/**
 * Web Push – reine Logik ohne Server-Abhängigkeiten (testbar).
 * Datenschutz (PRD §25, §39): Inhalte gehen über Push-Dienste Dritter, daher nie Gesundheitsdaten.
 */
export const PUSH_PRIORITIES = ['critical', 'action', 'info', 'social'] as const
export type PushPriority = (typeof PUSH_PRIORITIES)[number]

/**
 * Benachrichtigungsarten ohne klinischen Bezug: Titel darf mitgeschickt werden (nie der Text).
 * Alles andere – auch unbekannte Arten – gilt als klinisch und erhält nur einen allgemeinen Hinweis.
 */
const NON_CLINICAL = ['schedule', 'learn', 'document.review', 'docs', 'ack', 'post', 'chat', 'feedback']
const CLINICAL_HREF = /^\/(residents|quality|tasks|handover)(\/|$|\?)/

export function isClinicalNotification(kind: string, href?: string | null) {
  if (href && CLINICAL_HREF.test(href)) return true
  return !NON_CLINICAL.some((k) => kind === k || kind.startsWith(k + '.'))
}

/** Titel/Text der Push-Nachricht. Klinisch: «Kritische Meldung in Wohngruppe 2», sonst der Titel der Benachrichtigung. */
export function pushText(
  t: (k: string, v?: Record<string, string | number>) => string,
  n: { priority: PushPriority; kind: string; title: string; href?: string | null; unit?: string | null },
) {
  if (!isClinicalNotification(n.kind, n.href)) return { title: n.title.slice(0, 120), body: t('common.push.body') }
  const generic = n.priority === 'critical' || n.priority === 'action'
    ? (n.unit ? t(`common.push.${n.priority}In`, { unit: n.unit }) : t(`common.push.${n.priority}`))
    : t(`common.push.${n.priority}`)
  return { title: generic, body: t('common.push.body') }
}

export const normalizePriorities = (input: unknown): PushPriority[] =>
  Array.isArray(input) ? PUSH_PRIORITIES.filter((p) => input.includes(p)) : []
