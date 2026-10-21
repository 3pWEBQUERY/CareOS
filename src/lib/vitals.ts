/** Vitalparameter (PRD §14): Einheiten, Plausibilitätsgrenzen, Referenzbereiche. Server und Client. */
export const VITALS = {
  sys: { unit: 'mmHg', dec: 0, min: 60, max: 260, lo: 100, hi: 150 },
  dia: { unit: 'mmHg', dec: 0, min: 30, max: 150, lo: 50, hi: 90 },
  pulse: { unit: '/min', dec: 0, min: 30, max: 200, lo: 55, hi: 100 },
  temp: { unit: '°C', dec: 1, min: 33, max: 42.5, lo: 36.0, hi: 37.9 },
  spo2: { unit: '%', dec: 0, min: 50, max: 100, lo: 92, hi: 100 },
  glucose: { unit: 'mmol/l', dec: 1, min: 1, max: 35, lo: 4, hi: 10 },
  respRate: { unit: '/min', dec: 0, min: 4, max: 60, lo: 12, hi: 20 },
  pain: { unit: 'NRS', dec: 0, min: 0, max: 10, lo: 0, hi: 3 },
  weight: { unit: 'kg', dec: 1, min: 25, max: 250, lo: 0, hi: 999 },
} as const

export type VitalKey = keyof typeof VITALS
export const VITAL_KEYS = Object.keys(VITALS) as VitalKey[]
export type Limits = Record<VitalKey, { lo: number; hi: number }>

export function defaultLimits(): Limits {
  return Object.fromEntries(VITAL_KEYS.map((k) => [k, { lo: VITALS[k].lo, hi: VITALS[k].hi }])) as Limits
}

/** Organisationsweite Grenzwerte, überschrieben durch individuelle Grenzwerte des Bewohners. */
export function mergeLimits(rows: { key: string; lo: number; hi: number; residentId: string | null }[], residentId?: string): Limits {
  const l = defaultLimits()
  for (const r of rows.filter((r) => !r.residentId)) if (r.key in l) l[r.key as VitalKey] = { lo: r.lo, hi: r.hi }
  if (residentId) for (const r of rows.filter((r) => r.residentId === residentId)) if (r.key in l) l[r.key as VitalKey] = { lo: r.lo, hi: r.hi }
  return l
}

export function flag(key: VitalKey, v: number | null | undefined, limits: Limits): '' | 'lo' | 'hi' {
  if (v == null) return ''
  if (v < limits[key].lo) return 'lo'
  if (v > limits[key].hi) return 'hi'
  return ''
}

export type VitalRow = Partial<Record<VitalKey, number | null>>
export function abnormalKeys(v: VitalRow | null | undefined, limits: Limits) {
  if (!v) return [] as VitalKey[]
  return VITAL_KEYS.filter((k) => k !== 'weight' && v[k] != null && flag(k, v[k], limits))
}
