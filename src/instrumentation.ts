import type { Instrumentation } from 'next'

/**
 * Wird einmal pro Server-Instanz beim Start aufgerufen (Next.js instrumentation).
 * Startet die Hintergrundjobs (Eskalationen, Aufbewahrung, Bereinigung, Sicherheit) nur in der Node.js-Laufzeit.
 * Abschalten mit JOBS_DISABLED=true (z. B. für einzelne Instanzen oder Tests).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Startzeit und unbehandelte Fehler ausserhalb von Anfragen (Timer, Streams), PRD §66
  ;(await import('./lib/process-hooks')).installProcessHooks()
  if (process.env.JOBS_DISABLED === 'true') return
  const { startJobs } = await import('./lib/jobs')
  startJobs()
}

/** Serverfehler aus Seiten, Route Handlers, Server Actions und Proxy erfassen (src/lib/errors.ts). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { captureError } = await import('./lib/errors')
    await captureError(err, { route: context.routePath, routeType: context.routeType, method: request.method, path: request.path })
  } catch (e) {
    console.error('[onRequestError]', e)
  }
}
