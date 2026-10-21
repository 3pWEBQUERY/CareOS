/** Geheimnisse in Integrationskonfigurationen werden nach dem Speichern nie wieder angezeigt. */
export const MASK = '********'
const SENSITIVE = /secret|password|passwd|token|apikey|api_key|key$|credential|private/i

export function maskConfig(c: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, SENSITIVE.test(k) && v != null && v !== '' ? MASK : v && typeof v === 'object' && !Array.isArray(v) ? maskConfig(v as Record<string, unknown>) : v]))
}

/** Ersetzt maskierte Werte ("********") rekursiv durch die bisher gespeicherten. */
export function unmask(next: Record<string, unknown>, old: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(next).map(([k, v]) => {
    const o = old?.[k]
    if (v === MASK) return [k, o]
    if (v && typeof v === 'object' && !Array.isArray(v) && o && typeof o === 'object' && !Array.isArray(o)) return [k, unmask(v as Record<string, unknown>, o as Record<string, unknown>)]
    return [k, v]
  }))
}
