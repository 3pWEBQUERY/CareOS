import 'server-only'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { AiUnavailable, aiClient } from '@/lib/ai'
import type { Ctx } from '@/lib/context'
import type { Grid, RProblem } from './model'
import { aiSchema, buildPrompt, readAiResult } from './ai-format'

/**
 * KI-Dienstplanung mit Claude (Standard: Claude Haiku 5.5). Die KI erstellt einen Startplan und übersetzt die
 * Anweisungen der Leitung in Einschränkungen je Person. Verbindlich wird der Plan erst nach der Regelprüfung im
 * Solver (`plan`), der Verstösse entfernt und Lücken füllt – und nach Übernahme durch die Leitung.
 *
 * Datensparsam: Abwesenheiten ohne Grund (kein «krank»), keine Bewohnerdaten, Personen als Kürzel mit Namen nur
 * für die Zuordnung von Anweisungen.
 */
export async function aiRoster(ctx: Ctx, p: RProblem, current: Grid, mode: 'fill' | 'replace', monthLabel: string, instructions: string) {
  const client = await aiClient(ctx)
  const Schema = aiSchema(p.types.map((t) => t.code))
  const { system, user, alias } = buildPrompt(p, current, mode, monthLabel, instructions, ctx.locale)
  const stream = client.messages.stream({
    model: env.ai.model,
    max_tokens: 32000,
    output_config: { effort: 'high', format: zodOutputFormat(Schema) },
    system,
    messages: [{ role: 'user', content: user }],
  })
  const msg = await stream.finalMessage()
  if (msg.stop_reason === 'refusal') throw new AiUnavailable('refused')
  if (msg.stop_reason === 'max_tokens') throw new AiUnavailable('truncated')
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
  let parsed
  try {
    parsed = Schema.parse(JSON.parse(text))
  } catch {
    throw new AiUnavailable('invalid')
  }
  await db.aiInteraction.create({ data: { orgId: ctx.org.id, userId: ctx.user.id, kind: 'schedule', input: (system + '\n\n' + user).slice(0, 20000), output: text.slice(0, 20000), model: msg.model } })
  return { ...readAiResult(p, alias, parsed), model: msg.model }
}
