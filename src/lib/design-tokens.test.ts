import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COLOR_TOKENS, rgbToHex, worstContrast } from './design-tokens'

/** Tokens eines Selektors aus globals.css (alle Blöcke mit genau diesem Selektor, Kommentare entfernt). */
function tokens(css: string, selector: string) {
  const out: Record<string, string> = {}
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = new RegExp('(^|\\n)\\s*' + selector.replace(/[[\]"().]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g')
  for (const m of clean.matchAll(re)) for (const d of m[2].matchAll(/--([\w-]+):\s*([^;]+);?/g)) out[d[1]] = d[2].trim()
  return out
}

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')

for (const [name, sel] of [['hell', ':root'], ['dunkel', ':root[data-theme="dark"]']] as const) {
  test(`Design-Tokens ${name}: Kontrast aller Text- und Bedienfarben (WCAG 1.4.3 / 1.4.11)`, () => {
    const v = tokens(css, sel)
    for (const tok of COLOR_TOKENS) {
      assert.ok(v[tok.name], `--${tok.name} fehlt in ${sel}`)
      const w = worstContrast(v, tok)
      if (tok.on) assert.ok(w && w.ratio >= tok.min!, `--${tok.name} auf --${w?.against}: ${w?.ratio.toFixed(2)} < ${tok.min}`)
    }
  })
}

test('Design-Tokens: Systemeinstellung dunkel entspricht data-theme="dark"', () => {
  const dark = tokens(css, ':root[data-theme="dark"]')
  const i = css.indexOf('@media (prefers-color-scheme: dark)')
  const sys = tokens(css.slice(i), ':root[data-theme="system"]')
  for (const tok of COLOR_TOKENS) assert.equal(sys[tok.name], dark[tok.name], `--${tok.name}`)
})

test('rgbToHex', () => {
  assert.equal(rgbToHex('rgb(19, 32, 42)'), '#13202A')
  assert.equal(rgbToHex('rgba(0, 0, 0, 0)'), null)
  assert.equal(rgbToHex('color(srgb 1 0 0)'), null)
})
