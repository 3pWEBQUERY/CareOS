'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { IconSearch } from '@/components/icons'

export type PalItem = { group: string; label: string; hint?: string; href: string; keywords?: string }

/**
 * Globale Suche / Command Palette (PRD §24). Ctrl/⌘ K öffnet, "/" fokussiert Listenfilter.
 * Statische Ziele kommen vom Server, Treffer zu Bewohnenden, Dokumenten, Personen und Aufgaben live aus /api/search.
 */
export function CommandPalette({ items }: { items: PalItem[] }) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [remote, setRemote] = useState<PalItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const prevFocus = useRef<Element | null>(null)

  const show = useCallback(() => {
    prevFocus.current = document.activeElement
    setQ('')
    setIdx(0)
    setRemote([])
    setOpen(true)
  }, [])
  const hide = useCallback(() => {
    setOpen(false)
    ;(prevFocus.current as HTMLElement | null)?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        show()
      }
    }
    const onOpen = () => show()
    window.addEventListener('keydown', onKey)
    window.addEventListener('careos:palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('careos:palette', onOpen)
    }
  }, [show])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setRemote([])
      return
    }
    const ctl = new AbortController()
    const id = setTimeout(() => {
      fetch('/api/search?q=' + encodeURIComponent(q.trim()), { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items: PalItem[] }) => setRemote(d.items))
        .catch(() => {})
    }, 140)
    return () => {
      clearTimeout(id)
      ctl.abort()
    }
  }, [q, open])

  const needle = q.trim().toLowerCase()
  const local = items.filter((i) => !needle || (i.label + ' ' + (i.hint ?? '') + ' ' + (i.keywords ?? '') + ' ' + i.group).toLowerCase().includes(needle))
  const seen = new Set<string>()
  const list = [...remote, ...local].filter((i) => (seen.has(i.href + i.label) ? false : (seen.add(i.href + i.label), true))).slice(0, 40)
  const cur = Math.min(idx, Math.max(0, list.length - 1))

  function run(i: PalItem | undefined) {
    if (!i) return
    setOpen(false)
    router.push(i.href)
  }

  return (
    <>
      <button className="search-btn" type="button" onClick={show}>
        <IconSearch />
        <span>{t('common.palette.button')}</span>
        <kbd>Ctrl K</kbd>
      </button>
      {open && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && hide()}>
          <div className="pal" role="dialog" aria-modal="true" aria-label={t('common.palette.label')}>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setIdx(0) }}
              placeholder={t('common.palette.placeholder')}
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="pall"
              aria-activedescendant={list.length ? 'po' + cur : undefined}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(Math.min(list.length - 1, cur + 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(Math.max(0, cur - 1)) }
                else if (e.key === 'Enter') { e.preventDefault(); run(list[cur]) }
                else if (e.key === 'Escape') { e.preventDefault(); hide() }
              }}
            />
            <ul id="pall" role="listbox">
              {list.length ? (
                list.map((i, n) => (
                  <li key={i.href + i.label} id={'po' + n} role="option" aria-selected={n === cur} onMouseEnter={() => setIdx(n)} onClick={() => run(i)}>
                    <span>{i.label} {i.hint && <span className="k">{i.hint}</span>}</span>
                    <span className="grp">{i.group}</span>
                  </li>
                ))
              ) : (
                <li aria-disabled="true"><span className="k">{t('common.palette.empty')}</span></li>
              )}
            </ul>
            <div className="palfoot">{t('common.palette.hint')}</div>
          </div>
        </div>
      )}
    </>
  )
}
