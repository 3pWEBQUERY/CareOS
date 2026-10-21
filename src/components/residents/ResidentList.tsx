'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useT } from '@/i18n/client'

export type ResRow = { id: string; room: string; name: string; meta: string; over: number; open: number; changed: boolean; search: string }

/** Bewohnerliste (linke Spalte). "/" fokussiert den Filter. Im Auswahlmodus (?pick=notes) springt der Klick direkt in den Bereich. */
export function ResidentList({ rows }: { rows: ResRow[] }) {
  const t = useT()
  const path = usePathname()
  const sp = useSearchParams()
  const pick = sp.get('pick')
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName ?? '')) {
        e.preventDefault()
        ref.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const needle = q.trim().toLowerCase()
  const list = rows.filter((r) => !needle || r.search.includes(needle))
  const currentId = path.split('/')[2]
  return (
    <aside className="panel" aria-label={t('residents.list.title')}>
      <div className="list-head">
        <div className="row"><span className="lbl">{pick ? t(pick === 'vitals' ? 'residents.list.pickVitals' : 'residents.list.pickNotes') : t('residents.list.title')}</span><span className="small muted">{t('residents.list.count', { n: list.length, total: rows.length })}</span></div>
        <input ref={ref} className="field" type="search" placeholder={t('residents.list.filter')} autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('residents.list.filter')} />
      </div>
      <ul className="reslist">
        {list.length ? list.map((r) => (
          <li key={r.id}>
            <Link className="res" href={`/residents/${r.id}${pick ? '/' + pick : ''}`} aria-current={r.id === currentId ? 'true' : 'false'}>
              <span className="room">{r.room}</span>
              <span style={{ minWidth: 0 }}>
                <div className="nm">{r.name}{r.changed && <i className="chg" title={t('residents.list.changed')} />}</div>
                <div className="meta">{r.meta}</div>
              </span>
              <span className="counts">
                {r.over > 0 && <span className="pill crit" title={t('residents.list.overdue')}>{r.over}</span>}
                <span className={'pill' + (r.open ? '' : ' ok')} title={t('residents.list.openToday')}>{r.open || '✓'}</span>
              </span>
            </Link>
          </li>
        )) : <li className="small muted" style={{ padding: 12 }}>{t('residents.list.none')}</li>}
      </ul>
      <div className="list-foot">
        <span><i style={{ background: 'var(--crit-soft)', border: '1px solid var(--crit)' }} />{t('residents.list.overdue')}</span>
        <span><i style={{ background: 'var(--sunken)', border: '1px solid var(--line-strong)' }} />{t('residents.list.openToday')}</span>
      </div>
    </aside>
  )
}

export function Workspace({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  return <div className="workspace" data-detail={path.split('/').length > 2 ? 'true' : undefined}>{children}</div>
}
