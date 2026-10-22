'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/i18n/client'

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
declare global {
  interface Window { __careosInstall?: PromptEvent | null }
}

/** Fängt das Installationsangebot des Browsers früh ab (Root-Layout), damit es später angeboten werden kann. */
export function InstallCapture() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      window.__careosInstall = e as PromptEvent
      window.dispatchEvent(new Event('careos:installable'))
    }
    const onInstalled = () => {
      window.__careosInstall = null
      window.dispatchEvent(new Event('careos:installable'))
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  return null
}

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Karte «CareOS als App» für Profil und «Mehr»: Installieren, Hinweis für iOS oder Status. */
export function InstallApp() {
  const t = useT()
  const [state, setState] = useState<'unknown' | 'installed' | 'prompt' | 'ios' | 'other'>('unknown')
  useEffect(() => {
    const update = () => setState(standalone() ? 'installed' : window.__careosInstall ? 'prompt' : ios() ? 'ios' : 'other')
    update()
    window.addEventListener('careos:installable', update)
    return () => window.removeEventListener('careos:installable', update)
  }, [])
  if (state === 'unknown') return null
  return (
    <section className="card" aria-labelledby="pwa-title">
      <div className="card-head"><h2 id="pwa-title">{t('common.pwa.title')}</h2>{state === 'installed' && <span className="tag ok">{t('common.pwa.installed')}</span>}</div>
      <div className="card-body stack-sm">
        <p className="fg2" style={{ margin: 0 }}>{t('common.pwa.text')}</p>
        {state === 'prompt' && (
          <div>
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                const p = window.__careosInstall
                if (!p) return
                await p.prompt()
                await p.userChoice.catch(() => null)
                window.__careosInstall = null
                setState(standalone() ? 'installed' : 'other')
              }}
            >
              {t('common.pwa.install')}
            </button>
          </div>
        )}
        {state === 'ios' && <p className="small muted" style={{ margin: 0 }}>{t('common.pwa.iosHint')}</p>}
        {state === 'other' && <p className="small muted" style={{ margin: 0 }}>{t('common.pwa.otherHint')}</p>}
      </div>
    </section>
  )
}
