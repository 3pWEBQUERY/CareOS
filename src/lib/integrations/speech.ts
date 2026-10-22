/**
 * Schnittstelle Spracherkennung für das Diktat (PRD §10.4, §36) – vorbereitet.
 *
 * Zwei Wege:
 *  - «server»: eigener Speech-to-Text-Dienst (z. B. in der Schweiz gehostet) als Adapter; Audio geht vom Browser an
 *    CareOS und von dort an den Dienst. Aktivierung über Integration `speech_to_text` mit `config.provider = '<id>'`.
 *  - «browser»: Spracherkennung des Browsers (Web Speech API). Chrome/Edge/Safari senden das Audio an den
 *    Dienst des Herstellers – deshalb nur mit eigener Berechtigung und nach bestätigtem Datenschutzhinweis.
 * Ohne Adapter bleibt «browser» (falls erlaubt) oder kein Diktat.
 */

export type TranscribeResult = { ok: true; text: string } | { ok: false; reason: 'no_adapter' | 'too_large' | 'error' }

export interface SpeechToTextProvider {
  readonly id: string
  readonly name: string
  /** Datenstandort des Dienstes (Anzeige im Hinweis), z. B. «Schweiz» */
  readonly region?: string
  transcribe(audio: Uint8Array, opts: { mime: string; locale: string; signal?: AbortSignal }): Promise<string>
}

const ADAPTERS: Record<string, (config: Record<string, unknown>) => SpeechToTextProvider> = {}

export function registerSpeechAdapter(id: string, factory: (config: Record<string, unknown>) => SpeechToTextProvider) {
  ADAPTERS[id] = factory
}

/** Adapter zur aktiven Integration oder null (dann kein serverseitiges Diktat). */
export function speechProviderFor(integration: { active: boolean; config: unknown } | null | undefined): SpeechToTextProvider | null {
  if (!integration?.active) return null
  const cfg = (integration.config ?? {}) as Record<string, unknown>
  const factory = typeof cfg.provider === 'string' ? ADAPTERS[cfg.provider] : undefined
  return factory ? factory(cfg) : null
}

/** Höchstens 2 Minuten Sprache (ca. 2 MB Opus) pro Aufnahme. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024

export async function transcribe(provider: SpeechToTextProvider | null, audio: Uint8Array, mime: string, locale: string): Promise<TranscribeResult> {
  if (!provider) return { ok: false, reason: 'no_adapter' }
  if (audio.byteLength > MAX_AUDIO_BYTES) return { ok: false, reason: 'too_large' }
  try {
    const text = (await provider.transcribe(audio, { mime, locale, signal: AbortSignal.timeout(30_000) })).trim()
    return { ok: true, text }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

/** Version des Datenschutzhinweises zum Browser-Diktat; bei inhaltlicher Änderung erhöhen (erneute Bestätigung). */
export const DICTATION_NOTICE_VERSION = '1'
export const DICTATION_ACK = 'dictation.browser'

export type DictationMode = 'server' | 'browser' | 'none'
