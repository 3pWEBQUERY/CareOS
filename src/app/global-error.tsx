'use client'

import { useEffect, useState } from 'react'
import common from '@/i18n/messages/common'
import { makeT, pickLocale, type Tree } from '@/i18n/core'
import './globals.css'

/**
 * Letzte Auffangebene (Fehler im Root-Layout). Ersetzt das gesamte Dokument, daher eigene
 * <html>/<body>, Stile und Sprache aus dem Browser; Darstellung folgt dem System (PRD §31).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const [locale, setLocale] = useState<'de' | 'fr' | 'it' | 'en'>('de')
  useEffect(() => {
    setLocale(pickLocale(navigator.languages?.join(',') || navigator.language))
    console.error(error)
  }, [error])
  const t = makeT({ common: common[locale] } as Tree, locale, 'resident')
  const digest = error && typeof error === 'object' && 'digest' in error ? String((error as { digest?: unknown }).digest ?? '') : ''
  return (
    <html lang={locale} data-theme="system">
      <body>
        <title>CareOS</title>
        <main className="auth">
          <div className="auth-card" role="alert">
            <header><h1>{t('common.errorPage.title')}</h1></header>
            <div className="body">
              <p className="fg2" style={{ margin: 0 }}>{t('common.errorPage.textGlobal')}</p>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => retry()}>{t('common.errorPage.retry')}</button>
                <a className="btn ghost" href="/">{t('common.errorPage.home')}</a>
              </div>
              {digest && <p className="small muted" style={{ margin: 0 }}>{t('common.errorPage.digest')} <code className="mono">{digest}</code></p>}
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
