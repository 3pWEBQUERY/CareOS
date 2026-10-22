import { getCtx } from '@/lib/context'
import { Forbidden } from '@/components/ui/Empty'
import { allowedKinds } from '@/lib/import/run'
import { AdminHead } from '../Head'
import { ImportClient } from './ImportClient'

export async function generateMetadata() {
  const { t } = await getCtx()
  return { title: `${t('imports.title')} · ${t('nav.admin')}` }
}

/** Admin → Datenimport (PRD §41): CSV prüfen (Probelauf), Fehler je Zeile, Bericht, Import mit Audit. */
export default async function ImportPage() {
  const ctx = await getCtx()
  const { t } = ctx
  const kinds = ctx.can('admin.users') ? allowedKinds(ctx) : []
  if (!kinds.length) return <Forbidden text={t('common.notAllowed')} />
  return (
    <main className="panel main">
      <AdminHead section={t('admin.title')} title={t('imports.title')} sub={t('imports.sub')} />
      <div className="scroll">
        <div className="tabpanel">
          <ImportClient kinds={kinds} />
        </div>
      </div>
    </main>
  )
}
