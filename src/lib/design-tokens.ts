/**
 * Farbtokens des Design Systems (PRD §50–52) mit den Kontrastpaaren, in denen sie verwendet werden.
 * Die Werte selbst stehen nur in `src/app/globals.css`; die Design-System-Seite liest sie im Browser
 * (beide Darstellungen, inkl. Branding), der Test prüft die Paare gegen die CSS-Datei. Rein, Server und Client.
 */
import { contrastRatio } from './admin-shared'

export type TokenGroup = 'surface' | 'line' | 'text' | 'status' | 'on'
export type ColorToken = {
  name: string
  group: TokenGroup
  /** Kontrast gegen diese Flächen (schlechtester Wert zählt); min 4.5 = Text, 3 = Bedienelemente (WCAG 1.4.3 / 1.4.11) */
  on?: string[]
  min?: 4.5 | 3
}

const SURFACES = ['bg', 'surface', 'surface-2', 'sunken']

export const COLOR_TOKENS: ColorToken[] = [
  { name: 'bg', group: 'surface' },
  { name: 'surface', group: 'surface' },
  { name: 'surface-2', group: 'surface' },
  { name: 'sunken', group: 'surface' },
  { name: 'line', group: 'line' },
  { name: 'line-strong', group: 'line' },
  { name: 'line-ui', group: 'line', on: ['surface', 'surface-2'], min: 3 },
  { name: 'fg', group: 'text', on: SURFACES, min: 4.5 },
  { name: 'fg-2', group: 'text', on: SURFACES, min: 4.5 },
  { name: 'fg-3', group: 'text', on: [...SURFACES, 'accent-soft', 'ok-soft', 'warn-soft', 'crit-soft'], min: 4.5 },
  { name: 'accent', group: 'status', on: ['surface', 'surface-2', 'accent-soft'], min: 4.5 },
  { name: 'accent-soft', group: 'status' },
  { name: 'ok', group: 'status', on: ['surface', 'ok-soft'], min: 4.5 },
  { name: 'ok-soft', group: 'status' },
  { name: 'warn', group: 'status', on: ['surface', 'warn-soft'], min: 4.5 },
  { name: 'warn-soft', group: 'status' },
  { name: 'crit', group: 'status', on: ['surface', 'crit-soft'], min: 4.5 },
  { name: 'crit-soft', group: 'status' },
  { name: 'violet', group: 'status', on: ['surface', 'violet-soft'], min: 4.5 },
  { name: 'violet-soft', group: 'status' },
  { name: 'accent-fg', group: 'on', on: ['accent'], min: 4.5 },
  { name: 'on-solid', group: 'on', on: ['crit', 'ok', 'warn'], min: 4.5 },
]

/** Schlechtester Kontrast eines Tokens gegen seine Flächen, oder null (Fläche/Linie ohne Textbezug). */
export function worstContrast(values: Record<string, string>, tok: ColorToken): { ratio: number; against: string } | null {
  if (!tok.on || !isHex(values[tok.name])) return null
  let worst: { ratio: number; against: string } | null = null
  for (const bg of tok.on) {
    if (!isHex(values[bg])) continue
    const ratio = contrastRatio(values[tok.name], values[bg])
    if (!worst || ratio < worst.ratio) worst = { ratio, against: bg }
  }
  return worst
}

export const isHex = (v: string | undefined): v is string => !!v && /^#[0-9a-f]{6}$/i.test(v)

/** «rgb(19, 32, 42)» bzw. «rgba(…, 1)» → «#13202A»; transparente oder unbekannte Werte → null. */
export function rgbToHex(v: string): string | null {
  const m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/)
  if (!m || (m[4] != null && Number(m[4]) < 1)) return null
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** Schriftgrössen der Oberfläche (rem, Basis 16 px) mit dem Ort ihrer Verwendung in globals.css. */
export const TYPE_SCALE: { rem: number; use: string; sample: string }[] = [
  { rem: 0.625, use: 'axis', sample: '.chart .ax' },
  { rem: 0.6875, use: 'label', sample: '.lbl, .tag' },
  { rem: 0.75, use: 'small', sample: '.small' },
  { rem: 0.8125, use: 'dense', sample: '.stable, .alert, .btn.sm' },
  { rem: 0.875, use: 'body', sample: 'body' },
  { rem: 0.9375, use: 'section', sample: 'h2.sec' },
  { rem: 1, use: 'dialog', sample: '.dlg-head h2' },
  { rem: 1.1875, use: 'view', sample: '.view-head h1' },
  { rem: 1.25, use: 'metric', sample: '.metric .val' },
  { rem: 1.3125, use: 'banner', sample: '.banner h1' },
]

/** Abstände (px, in den Komponentenklassen fest) mit Beispiel. */
export const SPACING: { px: number; sample: string }[] = [
  { px: 4, sample: '.fld' },
  { px: 6, sample: '.chips' },
  { px: 8, sample: '.stack-sm' },
  { px: 10, sample: '.row' },
  { px: 12, sample: '.card-body, .form-grid' },
  { px: 16, sample: '.stack, .tabpanel' },
  { px: 18, sample: '.view-head, .tabpanel' },
  { px: 24, sample: '.tabpanel' },
]

export const RADII: { css: string; sample: string }[] = [
  { css: 'var(--r-sm)', sample: '--r-sm · .tag, .chip' },
  { css: 'var(--r)', sample: '--r · .btn, .field, .card' },
  { css: '999px', sample: '.sw' },
]
