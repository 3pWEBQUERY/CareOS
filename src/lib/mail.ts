import 'server-only'
import { log } from '@/lib/log'

/**
 * E-Mail-Versand – vorbereiteter Adapter (PRD §40). Ohne Konfiguration wird nichts versendet und die
 * aufrufende Stelle zeigt den Link zum Kopieren an.
 *
 * MAIL_WEBHOOK_URL: HTTPS-Endpunkt eines Mail-Dienstes bzw. eigenen Relays, erhält
 *   POST { to, subject, text } (JSON), optional mit `Authorization: Bearer MAIL_WEBHOOK_TOKEN`.
 * Inhalte enthalten nie Gesundheitsdaten.
 */
export const mailConfigured = () => /^https:\/\//.test(process.env.MAIL_WEBHOOK_URL ?? '')

export async function sendMail(m: { to: string; subject: string; text: string }): Promise<{ sent: boolean }> {
  if (!mailConfigured()) return { sent: false }
  try {
    const token = process.env.MAIL_WEBHOOK_TOKEN
    const res = await fetch(process.env.MAIL_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(m),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error('mail_http_' + res.status)
    return { sent: true }
  } catch (e) {
    log.warn('mail.failed', { error: e instanceof Error ? e.message : String(e) })
    return { sent: false }
  }
}
