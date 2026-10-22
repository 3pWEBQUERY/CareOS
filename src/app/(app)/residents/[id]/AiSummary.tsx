'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { IconSpark } from '@/components/icons'
import { discardSummary, residentSummary } from './actions'

/** KI-Zusammenfassung (PRD §23.1). Nur Anzeige, wird nie gespeichert. */
export function AiSummary({ residentId }: { residentId: string }) {
  const t = useT()
  const [res, setRes] = useState<{ id: string; text: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const run = () => start(async () => {
    setErr(null)
    const r = await residentSummary(residentId)
    if (!r.ok) return setErr(t(r.error))
    setRes(r.data ?? null)
  })
  const close = () => {
    if (res) void discardSummary(res.id)
    setRes(null)
  }
  return (
    <>
      {!res && (
        <span className="row">
          {err && <span className="err">{err}</span>}
          <button type="button" className="btn sm" onClick={run} data-loading={pending || undefined} disabled={pending}>
            <IconSpark size={14} />{pending ? t('common.ai.generating') : t('residents.overview.aiSummary')}
          </button>
        </span>
      )}
      {res && (
        <div className="ai-box" style={{ flexBasis: '100%' }} role="region" aria-label={t('residents.overview.aiSummary')}>
          <div className="ai-head"><span className="tag violet">{t('common.ai.badge')}</span><span>{t('common.ai.disclaimer')}</span></div>
          <div className="ai-text">{res.text}</div>
          <div className="row">
            <span className="small muted">{t('residents.overview.aiNotSaved')}</span>
            <span className="grow" />
            <button type="button" className="btn sm" onClick={run} disabled={pending}>{t('residents.overview.aiAgain')}</button>
            <button type="button" className="btn sm" onClick={close}>{t('common.close')}</button>
          </div>
        </div>
      )}
    </>
  )
}
