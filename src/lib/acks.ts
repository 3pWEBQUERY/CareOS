/**
 * Bestätigungen (PRD §45 Workflow – Bestätigungen): Organisationseinstellungen unter
 * Organization.settings.acks. Reine Logik, auf Server und Client nutzbar.
 */

export type AckSettings = {
  /** "Alle übernehmen" in der Übergabe erst, wenn wichtige Einträge einzeln übernommen sind. */
  handoverImportantRequiresAck: boolean
  /** Vorbelegung "Lesebestätigung verlangen" bei neuen Mitteilungen. */
  postsRequireAckDefault: boolean
  /** Kritische Dokumentversionen verlangen eine erneute Kenntnisnahme. */
  criticalDocsReAck: boolean
  /** Wichtige Verlaufseinträge müssen vom Team zur Kenntnis genommen werden. */
  residentImportantNoteRequiresAck: boolean
}

export const ACK_KEYS = ['handoverImportantRequiresAck', 'postsRequireAckDefault', 'criticalDocsReAck', 'residentImportantNoteRequiresAck'] as const satisfies readonly (keyof AckSettings)[]

export const ACK_DEFAULTS: AckSettings = {
  handoverImportantRequiresAck: true,
  postsRequireAckDefault: false,
  criticalDocsReAck: true,
  residentImportantNoteRequiresAck: false,
}

/** Liest settings.acks tolerant; fehlende Werte nehmen die Standardwerte an. */
export function ackSettings(settings: unknown): AckSettings {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).acks : null
  const o = s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : {}
  const out = { ...ACK_DEFAULTS }
  for (const k of ACK_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean
  return out
}

/** Subjekttyp für die Kenntnisnahme wichtiger Verlaufseinträge (Acknowledgement.subjectType). */
export const OBSERVATION_ACK = 'observation'
/** Zeitraum, in dem wichtige Verlaufseinträge auf der Startseite zur Kenntnisnahme erscheinen. */
export const OBSERVATION_ACK_DAYS = 3
