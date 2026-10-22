/**
 * Läuft im Browser vor der Hydration (Next.js instrumentation-client).
 * zod prüft beim ersten Parsen mit `new Function('')`, ob eval erlaubt ist. Unter der Content-Security-Policy
 * ohne 'unsafe-eval' (src/lib/csp.ts) erzeugt das einen gemeldeten Verstoss, obwohl der Fehler abgefangen wird.
 * jitless schaltet die Prüfung und die JIT-Optimierung ab (zod liest die Einstellung aus globalThis).
 */
const g = globalThis as unknown as { __zod_globalConfig?: Record<string, unknown> }
g.__zod_globalConfig = { ...(g.__zod_globalConfig ?? {}), jitless: true }
