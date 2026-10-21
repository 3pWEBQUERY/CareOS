import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { aiConfigured, env } from '@/lib/env'
import type { Ctx } from '@/lib/context'

/**
 * CareOS AI (PRD §23). Unterstützt Formulierung und Zusammenfassung – entscheidet nie.
 * Ergebnisse sind Entwürfe: Sie werden angezeigt, gekennzeichnet und erst nach Bestätigung gespeichert.
 * Jede Nutzung wird in AiInteraction protokolliert (Nachvollziehbarkeit).
 */
const SAFETY = `Du unterstützt Pflegefachpersonen in einer Schweizer Pflegeeinrichtung.
Regeln, die immer gelten:
- Stelle keine Diagnosen, verordne keine Medikamente, ändere keine Dosierungen und gib keine Therapieempfehlungen.
- Erfinde keine Fakten. Verwende nur, was im Input steht. Fehlt etwas, lass es weg.
- Schreibe sachlich, knapp, in der Fachsprache der Pflegedokumentation, Schweizer Rechtschreibung (ss statt ß).
- Keine Einleitung, keine Grussformel, kein Markdown ausser einfachen Aufzählungen mit "- ".`

export type AiKind = 'documentation' | 'handover' | 'resident_summary' | 'careplan' | 'search' | 'quality'

let client: Anthropic | null = null

export class AiUnavailable extends Error {}

export async function aiDraft(ctx: Ctx, kind: AiKind, instruction: string, input: string, maxTokens = 2000) {
  if (!aiConfigured()) throw new AiUnavailable('not_configured')
  const flag = await db.featureFlag.findUnique({ where: { orgId_key: { orgId: ctx.org.id, key: 'ai' } } })
  if (flag && !flag.enabled) throw new AiUnavailable('disabled')
  if (!ctx.can('ai.use')) throw new AiUnavailable('forbidden')
  client ??= new Anthropic({ apiKey: env.ai.apiKey })
  const lang = { de: 'Deutsch', fr: 'Französisch', it: 'Italienisch', en: 'Englisch' }[ctx.locale]
  const response = await client.beta.messages.create({
    model: env.ai.model,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: `${SAFETY}\nAntworte auf ${lang}.\n\n${instruction}`,
    messages: [{ role: 'user', content: input }],
  } as Parameters<typeof client.beta.messages.create>[0] & { stream?: false })
  const msg = response as Anthropic.Beta.BetaMessage
  if (msg.stop_reason === 'refusal') throw new AiUnavailable('refused')
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
  const row = await db.aiInteraction.create({ data: { orgId: ctx.org.id, userId: ctx.user.id, kind, input: input.slice(0, 20000), output: text, model: msg.model } })
  return { id: row.id, text }
}

/** Nach Übernahme oder Verwerfen aufrufen. */
export async function aiFeedback(ctx: Ctx, id: string, accepted: boolean) {
  await db.aiInteraction.updateMany({ where: { id, userId: ctx.user.id }, data: { accepted } })
}
