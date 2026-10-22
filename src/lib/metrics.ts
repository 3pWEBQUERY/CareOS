/**
 * Prozess-Metriken (PRD §66 Observability): einfache Zähler je Instanz, ausgegeben von /api/metrics
 * im Prometheus-Textformat zusammen mit Kennzahlen aus der Datenbank (instanzübergreifend).
 * Keine Personendaten in Labels (nur Routenmuster, Jobnamen, Status).
 */
type Labels = Record<string, string>
const g = globalThis as unknown as { __careosMetrics?: Map<string, number>; __careosStarted?: number }
const store = (g.__careosMetrics ??= new Map())
g.__careosStarted ??= Date.now()

const keyOf = (name: string, labels?: Labels) =>
  labels && Object.keys(labels).length
    ? `${name}{${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '_').slice(0, 80)}"`).join(',')}}`
    : name

export function count(name: string, labels?: Labels, by = 1) {
  const k = keyOf(name, labels)
  store.set(k, (store.get(k) ?? 0) + by)
}

export function gauge(name: string, value: number, labels?: Labels) {
  store.set(keyOf(name, labels), value)
}

export const startedAt = () => g.__careosStarted!

/** Prozesszähler als Prometheus-Zeilen. */
export function processMetrics(): string[] {
  const out: string[] = []
  const names = new Set<string>()
  for (const [k, v] of [...store.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const name = k.split('{')[0]
    if (!names.has(name)) {
      names.add(name)
      out.push(`# TYPE ${name} ${name.endsWith('_total') ? 'counter' : 'gauge'}`)
    }
    out.push(`${k} ${v}`)
  }
  return out
}

/** Routenmuster statt konkreter Pfade (keine Kennungen in Labels). */
export function routeLabel(path: string) {
  return (path.split('?')[0] || '/')
    .split('/')
    .map((s) => (/^[a-z0-9]{20,}$/i.test(s) || /^\d+$/.test(s) || /^[0-9a-f-]{32,}$/i.test(s) ? ':id' : s))
    .join('/')
    .slice(0, 120)
}
