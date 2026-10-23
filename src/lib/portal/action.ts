import 'server-only'
import { run, type ActionResult } from '@/lib/action'
import { PortalForbidden } from './context'

/**
 * Rahmen für Server Actions des Portals. Wie run(), aber ohne die MFA-Prüfung der Stationsapp
 * (die liest die Sitzung der Mitarbeitenden – im Portal nie massgeblich). Fehlende Freigabe → Hinweis statt Absturz.
 */
export async function portalRun<T>(fn: () => Promise<ActionResult<T> | void>): Promise<ActionResult<T>> {
  return run(async () => {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof PortalForbidden) return { ok: false, error: 'portal.errors.forbidden' }
      throw e
    }
  }, { allowDuringMfaSetup: true })
}
