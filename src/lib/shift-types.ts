import { durationMin } from '@/lib/roster/model'
import { TIME_RE } from '@/lib/admin-shared'

/** Farben für Dienstarten (Design-Tokens); F/S/N haben feste Farben, eigene Dienste wählen eine davon. */
export const SHIFT_COLORS = ['accent', 'violet', 'neutral', 'ok', 'warn', 'crit'] as const
export type ShiftColor = (typeof SHIFT_COLORS)[number]

type Result = { ok: true; data: { code: string; name: string; start: string; end: string; breakMinutes: number; color: string } } | { ok: false; error: string; field?: string }

/** Formularfelder einer Dienstart prüfen (Admin → Konfiguration und Monatsplan). */
export function parseShiftTypeForm(form: FormData): Result {
  const get = (k: string) => String(form.get(k) ?? '').trim()
  const code = get('code').toUpperCase()
  const name = get('name').slice(0, 60)
  const start = get('start')
  const end = get('end')
  const breakMinutes = Number(get('breakMinutes') || 0)
  const color = (SHIFT_COLORS as readonly string[]).includes(get('color')) ? get('color') : 'accent'
  if (!/^[A-Z0-9]{1,4}$/.test(code)) return { ok: false, error: 'admin.config.badCode', field: 'code' }
  if (name.length < 2) return { ok: false, error: 'admin.errors.name', field: 'name' }
  if (!TIME_RE.test(start)) return { ok: false, error: 'admin.config.badTime', field: 'start' }
  if (!TIME_RE.test(end) || end === start) return { ok: false, error: 'admin.config.badTime', field: 'end' }
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 240 || breakMinutes >= durationMin({ start, end })) return { ok: false, error: 'admin.config.badBreak', field: 'breakMinutes' }
  return { ok: true, data: { code, name, start, end, breakMinutes, color } }
}
