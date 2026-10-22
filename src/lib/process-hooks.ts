import { log } from '@/lib/log'
import { startedAt } from '@/lib/metrics'

/** Nur Node.js-Laufzeit (aus src/instrumentation.ts): Startzeit festhalten, unbehandelte Fehler protokollieren (PRD §66). */
export function installProcessHooks() {
  startedAt()
  const g = globalThis as unknown as { __careosHooks?: boolean }
  if (g.__careosHooks) return
  g.__careosHooks = true
  process.on('unhandledRejection', (reason) => log.error('process.unhandled_rejection', { error: reason }))
  process.on('uncaughtExceptionMonitor', (err, origin) => log.error('process.uncaught_exception', { error: err, origin }))
}
