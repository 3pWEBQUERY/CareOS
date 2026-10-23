'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { Switch } from '@/components/ui/fields'
import { ActButton } from '../../team/_ui/ActButton'
import { applyProposalAction, discardProposalAction } from '../roster-actions'
import type { RProposalView } from './types'

/** Stand eines Planungsvorschlags: läuft, fehlgeschlagen oder bereit zur Prüfung und Übernahme. */
export function ProposalBanner({ proposal: p, monthLabel, preview, onPreview, onRetry }: {
  proposal: RProposalView
  monthLabel: string
  preview: boolean
  onPreview: (v: boolean) => void
  onRetry: () => void
}) {
  const t = useT()
  const router = useRouter()

  // Solange die KI arbeitet, regelmässig neu laden (der Vorschlag entsteht im Hintergrund)
  useEffect(() => {
    if (p.status !== 'running') return
    const h = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(h)
  }, [p.status, router])

  const title = t('roster.proposal.title.' + p.source)
  if (p.status === 'running')
    return (
      <div className="alert info rst-proposal" role="status">
        <span className="spin" aria-hidden="true" />
        <span className="grow"><strong>{title}</strong> · {t('roster.proposal.running', { month: monthLabel })}<div className="small muted">{t('roster.proposal.runningHint')}</div></span>
        <ActButton action={() => discardProposalAction(p.id)} className="btn sm ghost">{t('roster.proposal.discard')}</ActButton>
      </div>
    )
  if (p.status === 'failed')
    return (
      <div className="alert crit rst-proposal" role="alert">
        <span className="grow"><strong>{t('roster.proposal.failed')}</strong><div className="small">{t('roster.aiError.' + (p.error ?? 'error'))}</div></span>
        <button type="button" className="btn sm" onClick={onRetry}>{t('common.errorPage.retry')}</button>
        <ActButton action={() => discardProposalAction(p.id)} className="btn sm ghost">{t('roster.proposal.discard')}</ActButton>
      </div>
    )

  const s = p.summary
  if (!s) return null
  const repaired = Object.entries(s.repairs).filter(([k]) => k !== 'fill').reduce((a, [, n]) => a + n, 0)
  return (
    <section className="card rst-proposal" aria-labelledby="rst-prop">
      <div className="card-head">
        <h2 id="rst-prop">{title}</h2>
        <span className="spacer" />
        <Switch label={t('roster.proposal.preview')} checked={preview} onChange={(e) => onPreview(e.currentTarget.checked)} />
      </div>
      <div className="card-body stack-sm">
        <div className="metrics metrics-sm2">
          <div className="metric"><span className="lbl">{t('roster.proposal.coverage')}</span><span className={'val' + (s.coverageRate < 100 ? ' warn' : ' ok')}>{s.coverageRate} <small>%</small></span><span className="small muted">{t('roster.proposal.before', { n: s.before.coverageRate })}</span></div>
          <div className="metric"><span className="lbl">{t('roster.proposal.errors')}</span><span className={'val' + (s.errors ? ' crit' : ' ok')}>{s.errors}</span><span className="small muted">{t('roster.proposal.beforeN', { n: s.before.errors })}</span></div>
          <div className="metric"><span className="lbl">{t('roster.proposal.wishes')}</span><span className="val">{s.wishes.total ? <>{s.wishes.met} <small>/ {s.wishes.total}</small></> : '–'}</span></div>
          <div className="metric"><span className="lbl">{t('roster.proposal.changes')}</span><span className="val">{s.changes}</span></div>
        </div>
        {!s.changes && <p className="small muted" style={{ margin: 0 }}>{t('roster.proposal.noChanges')}</p>}
        {!!s.notes?.length && (
          <div>
            <span className="lbl">{t('roster.proposal.notes')}</span>
            <ul className="small fg2" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        )}
        {!!s.constraints?.length && (
          <div>
            <span className="lbl">{t('roster.proposal.constraints')}</span>
            <ul className="small fg2" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {s.constraints.map((c, i) => (
                <li key={i}>{c.name}: {[c.allowed?.length ? t('roster.proposal.allowedOnly', { codes: c.allowed.join(', ') }) : '', c.offDays?.length ? t('roster.proposal.offOn', { days: c.offDays.map((d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.').join(', ') }) : ''].filter(Boolean).join(' · ')}</li>
              ))}
            </ul>
          </div>
        )}
        {p.source === 'ai' && repaired > 0 && <p className="small muted" style={{ margin: 0 }}>{t('roster.proposal.repairs', { n: repaired })}</p>}
        <div className="form-actions" style={{ marginTop: 0 }}>
          {s.changes > 0 && <ActButton action={() => applyProposalAction(p.id)} className="btn primary" confirm={`${t('roster.proposal.applyConfirm', { n: s.changes })} ${t('roster.proposal.applyBody')}`}>{t('roster.proposal.apply')}</ActButton>}
          <ActButton action={() => discardProposalAction(p.id)} className="btn ghost">{t('roster.proposal.discard')}</ActButton>
        </div>
      </div>
    </section>
  )
}
