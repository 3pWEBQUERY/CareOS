/**
 * Least Privilege (PRD §34/§37 «Administer ≠ Edit») – reine Logik.
 * Klinische Rechte: Akte, Medikation, Therapie, Aufgaben, Übergaben, klinische Kommunikation, KI und Kennzahlen.
 */
import { SYSADMIN_PERMISSIONS } from './permissions'

const CLINICAL_PREFIX = ['resident.', 'therapy.', 'task.', 'handover.', 'spitex.']
const CLINICAL_EXACT = ['chat.clinical', 'ai.use', 'insights.view', 'quality.manage']

export const isClinicalPermission = (p: string) => CLINICAL_PREFIX.some((x) => p.startsWith(x)) || CLINICAL_EXACT.includes(p)

/** Klinische Rechte einer Rolle (für den Hinweis bei der Systemadministration). */
export const clinicalPermissions = (perms: readonly string[]) => perms.filter(isClinicalPermission)

/**
 * Systemadministration verschlanken: klinische Rechte entfernen, übrige Anpassungen der Organisation behalten,
 * Notfallzugriff und persönliche API-Tokens ergänzen. Reihenfolge wie gespeichert, ohne Doppelte.
 */
export function slimSysadmin(perms: readonly string[]): string[] {
  const keep = perms.filter((p) => !isClinicalPermission(p))
  for (const p of SYSADMIN_PERMISSIONS) if (!keep.includes(p)) keep.push(p)
  return [...new Set(keep)]
}
