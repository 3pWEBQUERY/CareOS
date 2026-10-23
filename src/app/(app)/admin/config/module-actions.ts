'use server'

import { refresh } from 'next/cache'
import { getCtx, assertCan } from '@/lib/context'
import { run, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { MODULE_KEYS } from '@/lib/modules'
import { setOrgModules } from '@/lib/platform'

/** Module der eigenen Organisation (Admin → Klinische Konfiguration → Module, PRD §69). */
export async function saveModulesAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await getCtx()
    assertCan(ctx, 'admin.config')
    const wanted = MODULE_KEYS.filter((k) => fdBool(form, 'module:' + k))
    const { before, after } = await setOrgModules(ctx.org.id, wanted)
    if (before.join() !== after.join()) await audit(ctx, { action: 'admin.config.modules', entityType: 'Organization', entityId: ctx.org.id, before: { modules: before }, after: { modules: after } })
    refresh()
  })
}
