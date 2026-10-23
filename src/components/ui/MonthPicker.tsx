'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocale, useT } from '@/i18n/client'
import { INTL_LOCALE } from '@/i18n/core'
import { IconChevron, portalTarget, trapTab, useAnchoredPopover, useOutsideClose } from './field-popover'

/**
 * Monat und Jahr wählen (Navigation in Dienstplan und Kalendern): Knopf mit dem aktuellen Monat, Popover mit
 * Jahreswechsel und 12 Monaten, auf dem Handy als Blatt. Wählt per Pfeiltasten, Enter, Esc schliesst.
 *
 *   <MonthPicker value="2026-11" onChange={(m) => router.push(`?m=${m}`)} />
 */
export function MonthPicker({ value, onChange, label }: { value: string; onChange: (month: string) => void; label?: string }) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [y0, m0] = value.split('-').map(Number)
  const [year, setYear] = useState(y0)
  const [focus, setFocus] = useState(m0)
  const anchor = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const { sheet, style } = useAnchoredPopover(open, anchor, pop)
  useOutsideClose(open, [anchor, pop], () => setOpen(false))
  const fmt = (y: number, m: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(INTL_LOCALE[locale], opts).format(new Date(y, m - 1, 1))
  const now = new Date()
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  useEffect(() => {
    if (!open) return
    setYear(y0)
    setFocus(m0)
  }, [open, y0, m0])
  useEffect(() => {
    if (open) pop.current?.querySelector<HTMLButtonElement>(`[data-m="${focus}"]`)?.focus()
  }, [open, focus, year])

  const pick = (m: number) => {
    setOpen(false)
    anchor.current?.focus()
    onChange(`${year}-${String(m).padStart(2, '0')}`)
  }
  const onGridKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }
    if (!(e.key in step)) return
    e.preventDefault()
    let m = focus + step[e.key]
    let y = year
    if (m < 1) { m += 12; y-- }
    if (m > 12) { m -= 12; y++ }
    setYear(y)
    setFocus(m)
  }
  const target = open ? portalTarget(anchor.current) : null

  return (
    <>
      <button ref={anchor} type="button" className="mp-btn" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label ?? t('common.dt.chooseMonth')}: ${fmt(y0, m0, { month: 'long', year: 'numeric' })}`} onClick={() => setOpen((o) => !o)}>
        {fmt(y0, m0, { month: 'long', year: 'numeric' })}
        <IconChevron dir="down" />
      </button>
      {target && createPortal(
        <>
          {sheet && <div className="dtf-scrim" aria-hidden="true" />}
          <div ref={pop} className={'dtf-pop mp-pop' + (sheet ? ' is-sheet' : '')} style={style} role="dialog" aria-modal="true" aria-label={label ?? t('common.dt.chooseMonth')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); anchor.current?.focus() }
              else trapTab(e)
            }}>
            <div className="dtf-cal-head">
              <button type="button" className="dtf-nav" aria-label={t('common.dt.prevYear')} onClick={() => setYear((y) => y - 1)}><IconChevron dir="left" /></button>
              <span className="dtf-month" aria-live="polite">{year}</span>
              <button type="button" className="dtf-nav" aria-label={t('common.dt.nextYear')} onClick={() => setYear((y) => y + 1)}><IconChevron dir="right" /></button>
            </div>
            <div className="mp-grid" role="group" aria-label={String(year)} onKeyDown={onGridKey}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const key = `${year}-${String(m).padStart(2, '0')}`
                return (
                  <button key={m} type="button" data-m={m} tabIndex={m === focus ? 0 : -1} aria-pressed={key === value} aria-current={key === current ? 'date' : undefined}
                    aria-label={fmt(year, m, { month: 'long', year: 'numeric' })} onClick={() => pick(m)}>
                    {fmt(year, m, { month: 'short' }).replace('.', '')}
                  </button>
                )
              })}
            </div>
            {sheet && <div className="dtf-foot"><button type="button" className="btn sm ghost dtf-close" onClick={() => setOpen(false)}>{t('common.close')}</button></div>}
          </div>
        </>,
        target,
      )}
    </>
  )
}
