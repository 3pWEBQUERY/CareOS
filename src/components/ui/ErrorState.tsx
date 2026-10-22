'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useT } from '@/i18n/client'

/**
 * Ruhige Fehleranzeige für error.tsx (PRD §31/§32): keine technischen Details,
 * "Erneut versuchen" und die Fehlerkennung (digest) für den Support.
 */
export function ErrorState({ error, retry, compact }: { error: unknown; retry: () => void; compact?: boolean }) {
  const t = useT()
  const digest = error && typeof error === 'object' && 'digest' in error ? String((error as { digest?: unknown }).digest ?? '') : ''
  useEffect(() => {
    console.error(error)
  }, [error])
  const body = (
    <div className="stack-sm" role="alert" style={{ maxWidth: 560 }}>
      <h2 className="sec">{t('common.errorPage.title')}</h2>
      <p className="fg2" style={{ margin: 0 }}>{t(compact ? 'common.errorPage.textSection' : 'common.errorPage.text')}</p>
      <div className="row" style={{ marginTop: 4 }}>
        <button type="button" className="btn primary" onClick={() => retry()}>{t('common.errorPage.retry')}</button>
        {!compact && <Link className="btn ghost" href="/">{t('common.errorPage.home')}</Link>}
      </div>
      {digest && (
        <p className="small muted" style={{ margin: 0 }}>
          {t('common.errorPage.digest')} <code className="mono" style={{ userSelect: 'all' }}>{digest}</code>
        </p>
      )}
    </div>
  )
  if (compact) return <div className="card"><div className="card-body">{body}</div></div>
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="scroll">
        <div className="tabpanel">{body}</div>
      </div>
    </main>
  )
}

/** Hinweis "nicht gefunden" im Stil der App. */
export function NotFoundState({ compact, backHref = '/', backLabel }: { compact?: boolean; backHref?: string; backLabel?: string }) {
  const t = useT()
  const body = (
    <div className="empty" style={{ alignItems: 'center' }}>
      <strong>{t(compact ? 'common.notFoundPage.titleRecord' : 'common.notFoundPage.title')}</strong>
      <span className="small">{t(compact ? 'common.notFoundPage.textRecord' : 'common.notFoundPage.text')}</span>
      <Link className="btn" href={backHref}>{backLabel ?? t('common.notFoundPage.back')}</Link>
    </div>
  )
  if (compact) return body
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="scroll">
        <div className="tabpanel">{body}</div>
      </div>
    </main>
  )
}
