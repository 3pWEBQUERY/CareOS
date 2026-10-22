'use client'

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n/client'
import { SegmentedControl } from '@/components/ui/fields'

const isDark = () => {
  const v = document.documentElement.dataset.theme
  return v === 'dark' || (v === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
}

/**
 * Hell/Dunkel nur als Vorschau dieser Seite (nicht gespeichert). Beim Verlassen gilt wieder die gespeicherte
 * Darstellung – ausser sie wurde inzwischen über den Umschalter oben geändert.
 */
export function ThemePreview() {
  const t = useT()
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const set = useRef<string | null>(null)
  useEffect(() => {
    const root = document.documentElement
    const orig = root.dataset.theme ?? null
    setTheme(isDark() ? 'dark' : 'light')
    const mo = new MutationObserver(() => setTheme(isDark() ? 'dark' : 'light'))
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mo.disconnect()
      if (set.current && root.dataset.theme === set.current) {
        if (orig) root.dataset.theme = orig
        else delete root.dataset.theme
      }
    }
  }, [])
  return (
    <SegmentedControl
      name="ds-theme" label={t('design.theme.label')} hideLabel value={theme}
      options={[{ value: 'light', label: t('design.theme.light') }, { value: 'dark', label: t('design.theme.dark') }]}
      onChange={(v) => {
        set.current = v
        document.documentElement.dataset.theme = v
        setTheme(v as 'light' | 'dark')
      }}
    />
  )
}

export type DsState = 'default' | 'hover' | 'focus' | 'active' | 'disabled' | 'loading' | 'error' | 'success'
export const STATES: DsState[] = ['default', 'hover', 'focus', 'active', 'disabled', 'loading', 'error', 'success']

/**
 * Zustand erzwingen: setzt `data-ds-hover|focus|active` auf das erste Zielelement; die Regeln dazu erzeugt
 * `StateMirror` aus den echten :hover-/:focus-/:active-Regeln von globals.css.
 */
export function Forced({ state, target, children, pressed = true }: { state: DsState; target: string; children: React.ReactNode; pressed?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state !== 'hover' && state !== 'focus' && !(state === 'active' && pressed)) return
    ref.current?.querySelector(target)?.setAttribute('data-ds-' + state, '')
  })
  return <div ref={ref} className="ds-demo">{children}</div>
}

/** Raster der Zustände einer Komponente: n/a-Zellen zeigen «–». */
export function StateGrid({ title, target, render, selection }: {
  title: string
  target: string
  render: (s: DsState) => React.ReactNode | null
  /** Auswahl-Komponenten: «Aktiv» = ausgewählt (nicht zusätzlich «gedrückt») */
  selection?: boolean
}) {
  const t = useT()
  return (
    <section className="card" aria-label={title}>
      <div className="card-head"><h3>{title}</h3></div>
      <div className="card-body ds-states">
        {STATES.map((s) => {
          const node = render(s)
          return (
            <div key={s} className="ds-cell">
              <span className="lbl">{t('design.state.' + s)}</span>
              {node == null ? <span className="muted" title={t('design.na')}>–<span className="sr-only">{t('design.na')}</span></span> : <Forced state={s} target={target} pressed={!selection}>{node}</Forced>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
