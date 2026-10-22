import { headers } from 'next/headers'
import { getCtx } from '@/lib/context'
import { routeLabel } from '@/lib/metrics'
import { FeedbackForm } from './FeedbackForm'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('platform.feedback.title') }
}

/** In-App-Rückmeldung (PRD §62): erreichbar über die Befehlspalette und das Profil. */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { t } = await getCtx()
  const sp = await searchParams
  // Herkunft: ?from=… oder die vorherige Ansicht (Referer derselben Herkunft), ohne Query
  let raw = sp.from ?? ''
  if (!raw) {
    try {
      const h = await headers()
      const ref = new URL(h.get('referer') ?? '')
      if (ref.host === h.get('host')) raw = ref.pathname
    } catch {}
  }
  const from = raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/feedback') ? raw.split('?')[0].slice(0, 300) : ''
  return (
    <main className="panel main">
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <h1>{t('platform.feedback.title')}</h1>
          <p className="sub">{t('platform.feedback.sub')}</p>
        </div>
      </div>
      <div className="scroll">
        <div className="tabpanel" style={{ maxWidth: 720 }}>
          <section className="card" aria-label={t('platform.feedback.title')}>
            <div className="card-body">
              <FeedbackForm from={from} fromLabel={from ? routeLabel(from) : null} />
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
