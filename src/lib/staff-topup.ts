import { planStaff, type StaffKind } from './generate/people'

/**
 * Plätze, die beim Auffüllen auf `target` Mitarbeitende fehlen: Soll-Mix aus `planStaff`, abzüglich der
 * vorhandenen Personen je Art und Wohngruppe. Bestehende Personen werden nie verändert oder entfernt.
 */
export function topUpPlan(target: number, units: number, existing: { kind: StaffKind; unitIndex: number }[]) {
  const pool = new Map<string, number>()
  for (const e of existing) pool.set(`${e.kind}:${e.unitIndex}`, (pool.get(`${e.kind}:${e.unitIndex}`) ?? 0) + 1)
  const missing: { kind: StaffKind; unitIndex: number }[] = []
  for (const slot of planStaff(target, units)) {
    const k = `${slot.kind}:${slot.unitIndex}`
    const n = pool.get(k) ?? 0
    if (n > 0) pool.set(k, n - 1)
    else missing.push(slot)
  }
  // Nie über das Ziel hinaus, auch wenn vorhandene Personen anders verteilt sind
  return missing.slice(0, Math.max(0, target - existing.length))
}

/** Art einer bestehenden Person aus Rolle und Funktion (FaGe und HF teilen sich die Rolle «nurse»). */
export function kindOf(roleKeys: string[], jobTitle: string | null): StaffKind | null {
  if (roleKeys.includes('nursing_director')) return 'director'
  if (roleKeys.includes('ward_lead')) return 'lead'
  if (roleKeys.includes('care_assistant')) return 'aide'
  if (roleKeys.includes('nurse')) return /EFZ|FaGe|Gesundheit/i.test(jobTitle ?? '') ? 'fage' : 'rn'
  return null
}
