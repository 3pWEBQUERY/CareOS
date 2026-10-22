/**
 * Reine Hilfsfunktionen für Admin und Profil (Server und Client).
 */
import type { EventType } from '@/lib/events'

/** Alle Domain-Event-Typen als Laufzeitliste (Webhooks). Muss mit EventType übereinstimmen. */
export const EVENT_TYPES = [
  'task.created', 'task.completed', 'task.reopened', 'task.escalated',
  'observation.created', 'observation.corrected',
  'vitals.recorded', 'vitals.abnormal', 'vitals.corrected', 'vitals.reviewed',
  'medication.administered', 'medication.changed',
  'handover.updated', 'handover.acknowledged',
  'incident.reported', 'incident.updated',
  'careplan.updated', 'assessment.recorded', 'assessment.corrected', 'wound.updated', 'nutrition.recorded',
  'resident.updated', 'visit.updated', 'assignment.updated',
  'post.published', 'message.created',
  'document.published', 'schedule.changed', 'notification.created',
] as const satisfies readonly EventType[]
// Compile-Zeit-Prüfung: fehlt ein Typ in der Liste, schlägt der Typecheck fehl.
type MissingEvent = Exclude<EventType, (typeof EVENT_TYPES)[number]>
export const _eventListComplete: MissingEvent extends never ? true : MissingEvent = true

/** Scopes für API-Tokens (PRD §40). */
export const API_SCOPES = ['residents:read', 'tasks:read', 'tasks:write', 'observations:write', 'events:read', 'fhir:read', 'labs:write'] as const
export type ApiScope = (typeof API_SCOPES)[number]

/** Integrationsarten (PRD §40/§41) – informativ, die eigentliche Anbindung erfolgt über die Integration Layer. */
export const INTEGRATION_KINDS = ['hl7_fhir', 'hl7v2', 'pharmacy', 'lab', 'scheduling', 'identity_provider', 'drug_interactions'] as const

/** Hosting- und Datenstandorte (PRD §36). */
export const DATA_REGIONS = ['ch-zurich', 'ch-geneva', 'eu-central', 'eu-west', 'on-premise'] as const

export const FEATURE_FLAGS = ['ai', 'voice', 'medication'] as const

export const HEX_RE = /^#[0-9a-fA-F]{6}$/

function channel(c: number) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
/** Kontrastverhältnis nach WCAG 2.1. */
export function contrastRatio(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** Grobe Geräteerkennung aus dem User-Agent – nur zur Anzeige in der Sitzungsliste. */
export function parseUserAgent(ua: string | null | undefined) {
  const s = ua ?? ''
  const browser =
    /Edg\//.test(s) ? 'Edge'
      : /OPR\/|Opera/.test(s) ? 'Opera'
        : /Firefox\//.test(s) ? 'Firefox'
          : /Chrome\/|CriOS\//.test(s) ? 'Chrome'
            : /Safari\//.test(s) ? 'Safari'
              : /curl\//i.test(s) ? 'curl'
                : ''
  const os =
    /iPhone|iPad|iPod/.test(s) ? 'iOS'
      : /Android/.test(s) ? 'Android'
        : /Windows/.test(s) ? 'Windows'
          : /Mac OS X|Macintosh/.test(s) ? 'macOS'
            : /CrOS/.test(s) ? 'ChromeOS'
              : /Linux/.test(s) ? 'Linux'
                : ''
  const kind: 'mobile' | 'tablet' | 'desktop' = /iPad|Tablet/.test(s) ? 'tablet' : /Mobi|iPhone|Android/.test(s) ? 'mobile' : 'desktop'
  return { browser, os, kind }
}

/** Schlüssel einer Berechtigung als i18n-Pfad: "resident.chart.write" → "resident_chart_write". */
export const permKey = (p: string) => p.replace(/\./g, '_')

/** Aus einem Namen einen stabilen Schlüssel ableiten (Rollen, Ereignistypen). */
export function slugKey(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export const UNIT_KINDS = ['ward', 'group', 'dementia', 'day', 'other'] as const

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
