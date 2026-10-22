/**
 * Wird einmal pro Server-Instanz beim Start aufgerufen (Next.js instrumentation).
 * Startet die Hintergrundjobs (Eskalationen, Aufbewahrung, Bereinigung) nur in der Node.js-Laufzeit.
 * Abschalten mit JOBS_DISABLED=true (z. B. für einzelne Instanzen oder Tests).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.JOBS_DISABLED === 'true') return
  const { startJobs } = await import('./lib/jobs')
  startJobs()
}
