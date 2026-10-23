'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import type { Issue } from '@/lib/roster/evaluate'
import { issueText } from './format'
import type { RDay, RPersonRow, RTypeOpt } from './types'

const LIMIT = 12

/** Regelprüfung unter dem Raster: Fehler und Warnungen je Person und je Tag; ein Klick springt zur Zelle. */
export function RosterIssues({ issues, people, fmt, onShow }: {
  issues: Issue[]
  people: RPersonRow[]
  fmt: { days: Map<string, RDay>; types: Map<string, RTypeOpt>; keyQual: string | null }
  onShow: (userId: string, day: string) => void
}) {
  const t = useT()
  const [all, setAll] = useState(false)
  const names = new Map(people.map((p) => [p.id, p.name]))
  const relevant = issues.filter((i) => i.severity !== 'info')
  const errors = relevant.filter((i) => i.severity === 'error')
  const warnings = relevant.filter((i) => i.severity === 'warn')
  const byPerson = relevant.filter((i) => i.user)
  const byDay = relevant.filter((i) => !i.user)
  if (!relevant.length) return <div className="alert ok"><span className="grow">✓ {t('roster.issues.none')}</span></div>

  const item = (i: Issue, k: number) => {
    const text = issueText(t, i, fmt)
    const who = i.user ? names.get(i.user) : ''
    const day = i.day && i.code !== 'weekly' ? fmt.days.get(i.day)?.label : ''
    const target = i.user ? { user: i.user, day: i.day ?? '' } : null
    return (
      <li key={k} className={i.severity === 'error' ? 'crit-text' : undefined}>
        {i.severity === 'error' ? '▲ ' : ''}
        {target ? (
          <button type="button" className="linkbtn" onClick={() => onShow(target.user, target.day)} title={t('roster.issues.show')}>{[who, day].filter(Boolean).join(' · ')}</button>
        ) : null}
        {target ? ': ' : ''}{text}
      </li>
    )
  }
  const list = (arr: Issue[]) => {
    const shown = all ? arr : arr.slice(0, LIMIT)
    return (
      <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {shown.map(item)}
        {!all && arr.length > LIMIT && <li><button type="button" className="linkbtn" onClick={() => setAll(true)}>{t('roster.issues.more', { n: arr.length - LIMIT })}</button></li>}
      </ul>
    )
  }
  return (
    <section className={'alert ' + (errors.length ? 'crit' : 'warn') + ' rst-issues no-print'} aria-labelledby="rst-iss">
      <div className="grow stack-sm">
        <h2 id="rst-iss" className="sec" style={{ margin: 0 }}>
          {t('roster.issues.title')} · {[errors.length ? t('roster.issues.errors', { n: errors.length }) : '', warnings.length ? t('roster.issues.warnings', { n: warnings.length }) : ''].filter(Boolean).join(' · ')}
        </h2>
        <div className="grid-2">
          {byPerson.length > 0 && <div><span className="lbl">{t('roster.issues.people')}</span>{list(byPerson)}</div>}
          {byDay.length > 0 && <div><span className="lbl">{t('roster.issues.days')}</span>{list(byDay)}</div>}
        </div>
      </div>
    </section>
  )
}
