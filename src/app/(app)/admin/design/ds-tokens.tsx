'use client'

import { Fragment, useEffect, useState } from 'react'
import { useLocale, useT } from '@/i18n/client'
import { fmtNum } from '@/lib/time'
import { COLOR_TOKENS, RADII, SPACING, TYPE_SCALE, rgbToHex, worstContrast, type TokenGroup } from '@/lib/design-tokens'
import { Bar } from '@/components/ui/Skeleton'

type Values = Record<string, string>

/**
 * Aufgelöste Farbwerte einer Darstellung: data-theme wird synchron umgeschaltet, gelesen und zurückgesetzt
 * (kein Zwischenbild). So erscheinen die echten Werte aus globals.css inklusive Branding.
 */
function readTheme(theme: 'light' | 'dark'): Values {
  const root = document.documentElement
  const prev = root.getAttribute('data-theme')
  const probe = document.createElement('span')
  probe.hidden = true
  document.body.appendChild(probe)
  root.setAttribute('data-theme', theme)
  const out: Values = {}
  try {
    for (const tok of COLOR_TOKENS) {
      probe.style.color = `var(--${tok.name})`
      const hex = rgbToHex(getComputedStyle(probe).color)
      if (hex) out[tok.name] = hex
    }
  } finally {
    if (prev == null) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', prev)
    probe.remove()
  }
  return out
}

const GROUPS: TokenGroup[] = ['surface', 'line', 'text', 'status', 'on']

export function Tokens() {
  const t = useT()
  const locale = useLocale()
  const [vals, setVals] = useState<{ light: Values; dark: Values } | null>(null)
  useEffect(() => setVals({ light: readTheme('light'), dark: readTheme('dark') }), [])

  const cell = (v: Values | undefined, name: string) => {
    const tok = COLOR_TOKENS.find((x) => x.name === name)!
    if (!v) return <td><Bar w={120} /></td>
    const w = worstContrast(v, tok)
    const ok = w && w.ratio >= tok.min!
    return (
      <td>
        <div className="row ds-tok">
          <span className="ds-swatch" style={{ background: v[name] }} aria-hidden="true" />
          <span className="mono">{v[name] ?? '–'}</span>
          {w && (
            <span className="small nowrap">
              <span className="mono">{fmtNum(w.ratio, 2, locale)}:1</span>{' '}
              <span className={'tag ' + (ok ? 'ok' : 'crit')}>{ok ? '✓ ' + t('design.tokens.pass', { min: fmtNum(tok.min!, 1, locale) }) : '✕ ' + t('design.tokens.fail', { min: fmtNum(tok.min!, 1, locale) })}</span>
              <span className="muted"> {t('design.tokens.against', { bg: '--' + w.against })}</span>
            </span>
          )}
        </div>
      </td>
    )
  }

  return (
    <div className="stack">
      <div className="tablewrap">
        <table className="stable ds-colors">
          <caption className="sr-only">{t('design.tokens.colors')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('design.tokens.token')}</th>
              <th scope="col">{t('design.tokens.light')}</th>
              <th scope="col">{t('design.tokens.dark')}</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <Fragment key={g}>
                <tr className="ds-group"><th scope="rowgroup" colSpan={3} className="lbl">{t('design.tokens.group.' + g)}</th></tr>
                {COLOR_TOKENS.filter((x) => x.group === g).map((tok) => (
                  <tr key={tok.name}>
                    <th scope="row" className="mono">--{tok.name}</th>
                    {cell(vals?.light, tok.name)}
                    {cell(vals?.dark, tok.name)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted ds-note">{t('design.tokens.contrastHint')}</p>

      <div className="grid-2">
        <section className="card" aria-labelledby="ds-type">
          <div className="card-head"><h3 id="ds-type">{t('design.tokens.type')}</h3><span className="small muted">{t('design.tokens.typeHint')}</span></div>
          <div className="tablewrap ds-flat">
            <table className="stable">
              <thead><tr><th scope="col">{t('design.tokens.size')}</th><th scope="col">{t('design.tokens.use')}</th><th scope="col">{t('design.tokens.sample')}</th></tr></thead>
              <tbody>
                {TYPE_SCALE.map((s) => (
                  <tr key={s.rem}>
                    <td className="num nowrap">{fmtNum(s.rem, 4, locale).replace(/0+$/, '').replace(/[.,]$/, '')} rem<div className="small muted">{fmtNum(s.rem * 16, 0, locale)} px</div></td>
                    <td>{t('design.tokens.uses.' + s.use)}<div className="small muted mono">{s.sample}</div></td>
                    <td><span style={{ fontSize: s.rem + 'rem', lineHeight: 1.25 }}>{t('design.tokens.sampleText')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot stack-sm">
            <span className="lbl">{t('design.tokens.fonts')}</span>
            <span style={{ fontFamily: 'var(--font-ui)' }}>IBM Plex Sans · {t('design.tokens.fontUi')}</span>
            <span className="lbl" style={{ fontSize: '0.8125rem' }}>IBM Plex Sans Condensed · {t('design.tokens.fontCond')}</span>
            <span className="mono">IBM Plex Mono · 07:30 · 38,1 °C · {t('design.tokens.fontMono')}</span>
          </div>
        </section>

        <div className="stack">
          <section className="card" aria-labelledby="ds-space">
            <div className="card-head"><h3 id="ds-space">{t('design.tokens.spacing')}</h3><span className="small muted">{t('design.tokens.spacingHint')}</span></div>
            <ul className="list">
              {SPACING.map((s) => (
                <li key={s.px} className="li ds-space">
                  <span className="mono nowrap">{s.px} px</span>
                  <span className="ds-space-bar" style={{ width: s.px * 4 }} aria-hidden="true" />
                  <span className="small muted mono grow">{s.sample}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card" aria-labelledby="ds-radii">
            <div className="card-head"><h3 id="ds-radii">{t('design.tokens.radii')}</h3></div>
            <div className="card-body row">
              {RADII.map((r) => (
                <div key={r.css} className="ds-radius">
                  <span className="ds-radius-box" style={{ borderRadius: r.css }} aria-hidden="true" />
                  <span className="small mono">{r.sample}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
