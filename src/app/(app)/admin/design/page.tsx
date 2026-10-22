import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { AdminHead } from '../Head'
import { ThemePreview } from './ds-shell'
import { Tokens } from './ds-tokens'
import { ButtonStates, FieldStates, StateMirror, StatusLanguage } from './ds-states'
import { Charts, Clinical, DataDisplay, Feedback, FieldGallery, Loading, Overlays } from './ds-components'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: t('design.title') }
}

const SECTIONS = ['tokens', 'status', 'buttons', 'fields', 'states', 'data', 'clinical', 'overlays', 'feedback', 'charts', 'loading'] as const

/**
 * Design System (PRD §50–52, §54 Phase 0): alle Komponenten mit ihren Zuständen, die Statussprache und die Tokens –
 * ausschliesslich mit den echten Komponenten und Klassen der App und Beispieldaten, ohne Speichern.
 */
export default async function DesignSystemPage() {
  const ctx = await getCtx()
  const { t } = ctx
  if (!ctx.can('admin.config')) return <Forbidden text={t('common.notAllowed')} title={t('design.title')} />
  const sec = (key: (typeof SECTIONS)[number], body: React.ReactNode) => (
    <section className="stack-sm ds-sec" id={'ds-' + key} aria-labelledby={'ds-h-' + key}>
      <div className="sec-head">
        <h2 className="sec" id={'ds-h-' + key}>{t('design.sec.' + key)}</h2>
        <span className="small muted">{t('design.hint.' + key)}</span>
      </div>
      {body}
    </section>
  )
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('design.title')} sub={t('design.sub')}>
        <ThemePreview />
      </AdminHead>
      <div className="scroll">
        <div className="tabpanel">
          <StateMirror />
          <nav aria-label={t('design.toc')}>
            <ul className="chips ds-toc">
              {SECTIONS.map((s) => <li key={s}><a className="chip" href={'#ds-' + s}>{t('design.sec.' + s)}</a></li>)}
            </ul>
          </nav>
          {sec('tokens', <Tokens />)}
          {sec('status', <StatusLanguage />)}
          {sec('buttons', <ButtonStates />)}
          {sec('fields', <FieldGallery />)}
          {sec('states', <FieldStates />)}
          {sec('data', <DataDisplay />)}
          {sec('clinical', <Clinical />)}
          {sec('overlays', <Overlays />)}
          {sec('feedback', <Feedback />)}
          {sec('charts', <Charts />)}
          {sec('loading', <Loading />)}
        </div>
      </div>
    </main>
  )
}
