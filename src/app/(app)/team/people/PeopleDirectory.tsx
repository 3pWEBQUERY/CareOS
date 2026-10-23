'use client'

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'
import { normalize } from '@/lib/combobox'
import { Avatar } from '@/components/people/Avatar'
import { SearchField, Select } from '@/components/ui/fields'
import type { DirectoryRow, TodayState } from '@/lib/people'

type Filter = '' | 'now' | 'today'

/** Status «heute» als Text mit Dienstcode – nie nur Farbe (PRD §51). */
export function TodayTag({ today }: { today: TodayState }) {
  const t = useT()
  if (!today) return null
  if (today.kind === 'absent') return <span className="tag outline">{t('people.today.absent')}</span>
  return (
    <span className="ppl-today">
      <span className={'sh ' + today.code}>{today.code}</span>
      <span className={today.running ? 'ok-text' : today.done ? 'muted' : ''}>
        {today.running ? t('people.today.running', { time: today.end }) : today.done ? t('people.today.done') : t('people.today.planned', { from: today.start, to: today.end })}
      </span>
    </span>
  )
}

export function PeopleDirectory({ rows, units, schedule, initial }: {
  rows: DirectoryRow[]
  units: { id: string; name: string; group: string }[]
  schedule: boolean
  initial: { q: string; unit: string; f: Filter }
}) {
  const t = useT()
  const [q, setQ] = useState(initial.q)
  const [unit, setUnit] = useState(units.some((u) => u.id === initial.unit) ? initial.unit : '')
  const [f, setF] = useState<Filter>(schedule ? initial.f : '')
  const query = useDeferredValue(q)

  // Filter in der Adresse festhalten (Zurück-Navigation, Link teilen), ohne neu zu laden
  useEffect(() => {
    const u = new URL(window.location.href)
    for (const [k, v] of [['q', q.trim()], ['unit', unit], ['f', f]] as const) if (v) u.searchParams.set(k, v); else u.searchParams.delete(k)
    window.history.replaceState(window.history.state, '', u.pathname + (u.search ? u.search : ''))
  }, [q, unit, f])

  const scope = (r: DirectoryRow) => (r.orgWide ? t('people.orgWide') : r.units)
  const index = useMemo(() => rows.map((r) => ({ r, hay: normalize([r.firstName, r.lastName, r.initials, r.jobTitle ?? '', r.orgWide ? t('people.orgWide') : r.units, ...r.qualifications].join(' ')) })), [rows, t])
  const list = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean)
    return index
      .filter(({ r, hay }) => {
        if (words.length && !words.every((w) => hay.includes(w))) return false
        if (unit && !r.unitIds.includes(unit)) return false
        if (f === 'now' && !(r.today?.kind === 'shift' && r.today.running)) return false
        if (f === 'today' && r.today?.kind !== 'shift') return false
        return true
      })
      .map((x) => x.r)
  }, [index, query, unit, f])

  const groups = [...new Set(units.map((u) => u.group))]
  const filtered = !!(q.trim() || unit || f)

  return (
    <div className="stack">
      <div className="ppl-bar" role="search">
        <SearchField label={t('people.search')} hideLabel value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('people.searchPlaceholder')} autoComplete="off" wrapClassName="ppl-q" />
        <Select label={t('people.unit')} hideLabel value={unit} onChange={(e) => setUnit(e.target.value)} wrapClassName="ppl-unit">
          <option value="">{t('people.allUnits')}</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {units.filter((u) => u.group === g).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </optgroup>
          ))}
        </Select>
        {schedule && (
          <div className="chips" role="group" aria-label={t('people.filter.label')}>
            {(['', 'now', 'today'] as const).map((k) => (
              <button key={k || 'all'} type="button" className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{t('people.filter.' + (k || 'all'))}</button>
            ))}
          </div>
        )}
      </div>

      <p className="small muted" role="status" aria-live="polite" style={{ margin: 0 }}>{t('people.count', { n: list.length })}</p>

      {list.length ? (
        <ul className="list ppl-list card">
          {list.map((r) => (
            <li key={r.id}>
              <Link className="li ppl-row" href={`/team/people/${r.id}`}>
                <Avatar src={r.avatar} initials={r.initials} />
                <span className="ppl-main">
                  <span className="ppl-name">{r.lastName} {r.firstName}</span>
                  <span className="small muted ppl-sub">{[r.jobTitle, scope(r)].filter(Boolean).join(' · ')}</span>
                </span>
                {schedule && <span className="ppl-state"><TodayTag today={r.today} /></span>}
                {r.workPhone && <span className="mono small muted ppl-phone">{r.workPhone}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">
          <strong>{t('people.empty')}</strong>
          {filtered && <button type="button" className="btn sm" onClick={() => { setQ(''); setUnit(''); setF('') }}>{t('people.reset')}</button>}
        </div>
      )}
    </div>
  )
}
