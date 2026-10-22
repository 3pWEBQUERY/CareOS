import { isIsoDateTime } from '@/lib/date-input'

/** Wert aus DateTimeField (YYYY-MM-DDTHH:MM, Serverzeit Europe/Zurich) → Date, sonst null. */
export function parseDateTimeInput(v: string): Date | null {
  if (!isIsoDateTime(v)) return null
  const d = new Date(v + ':00')
  return Number.isNaN(d.getTime()) ? null : d
}

/** Date → Wert für DateTimeField (lokale Zeit). */
export function toDateTimeInput(d: Date | null | undefined) {
  if (!d) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export const INCIDENT_KINDS = ['confidentiality', 'integrity', 'availability'] as const
export const INCIDENT_RISKS = ['low', 'medium', 'high'] as const
export const INCIDENT_STATUS = ['open', 'assessed', 'reported', 'closed'] as const
export const DATA_CATEGORIES = ['health', 'identity', 'contact', 'staff', 'credentials', 'other'] as const

/** Meldefrist 72 Stunden ab Bekanntwerden (Art. 33 DSGVO; DSG: so rasch als möglich). */
export const DEADLINE_MS = 72 * 3600_000
export function deadlineState(i: { discoveredAt: Date; authorityRequired: boolean | null; authorityNotifiedAt: Date | null; status: string }, now = new Date()) {
  if (i.authorityRequired === false) return { kind: 'none' as const }
  if (i.authorityNotifiedAt) return { kind: 'notified' as const, at: i.authorityNotifiedAt }
  const due = new Date(i.discoveredAt.getTime() + DEADLINE_MS)
  const left = due.getTime() - now.getTime()
  if (i.status === 'closed' && i.authorityRequired == null) return { kind: 'none' as const }
  return { kind: left < 0 ? ('over' as const) : ('open' as const), due, hoursLeft: Math.max(0, Math.floor(left / 3600_000)) }
}
