/**
 * Granulare Berechtigungen (PRD §34). Schlüssel sind stabil und werden in Role.permissions gespeichert.
 * Beispiel: resident.medication.administer ist unabhängig von resident.medication.edit.
 */
export const PERMISSIONS = {
  'resident.read': 'Bewohnerakte lesen',
  'resident.create': 'Bewohner aufnehmen',
  'resident.edit': 'Stammdaten bearbeiten',
  'resident.chart.write': 'Pflegebericht schreiben',
  'resident.chart.correct': 'Einträge korrigieren',
  'resident.vitals.write': 'Vitalwerte erfassen',
  'resident.careplan.edit': 'Pflegeplanung bearbeiten',
  'resident.careplan.approve': 'Pflegeplanung freigeben',
  'resident.assessment.write': 'Assessments durchführen',
  'resident.wounds.write': 'Wunddokumentation',
  'resident.nutrition.write': 'Ernährung dokumentieren',
  'resident.medication.read': 'Medikation einsehen',
  'resident.medication.administer': 'Medikamente abgeben',
  'resident.medication.edit': 'Verordnungen erfassen und ändern',
  'resident.medication.doublecheck': 'Vier-Augen-Kontrolle',
  'resident.visit.conduct': 'Visite dokumentieren (ärztliche Anordnungen erfassen)',
  'task.read': 'Aufgaben sehen',
  'task.complete': 'Aufgaben quittieren',
  'task.manage': 'Aufgaben erstellen und zuweisen',
  'handover.read': 'Übergaben lesen',
  'handover.write': 'Übergaben schreiben',
  'schedule.read': 'Dienstplan sehen',
  'schedule.manage': 'Dienstplan planen, Abwesenheiten genehmigen',
  'team.read': 'Mitteilungen lesen',
  'team.post': 'Mitteilungen veröffentlichen',
  'team.moderate': 'Channels moderieren',
  'chat.use': 'Chat verwenden',
  'chat.clinical': 'Klinische Kommunikation',
  'docs.read': 'Dokumente lesen',
  'docs.manage': 'Dokumente erstellen und bearbeiten',
  'docs.approve': 'Dokumente freigeben',
  'learn.read': 'Schulungen absolvieren',
  'learn.manage': 'Schulungen verwalten und zuweisen',
  'quality.report': 'Ereignisse melden',
  'quality.manage': 'Ereignisse bearbeiten und abschliessen',
  'insights.view': 'Kennzahlen einsehen',
  'admin.org': 'Organisation verwalten',
  'admin.users': 'Benutzer verwalten',
  'admin.roles': 'Rollen und Berechtigungen',
  'admin.config': 'Klinische Konfiguration',
  'admin.audit': 'Audit-Protokoll einsehen',
  'admin.integrations': 'Schnittstellen und API',
  'ai.use': 'CareOS AI verwenden',
} as const

export type Permission = keyof typeof PERMISSIONS
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

export const PERMISSION_GROUPS: { key: string; prefix: string[] }[] = [
  { key: 'clinical', prefix: ['resident.'] },
  { key: 'operations', prefix: ['task.', 'handover.', 'schedule.'] },
  { key: 'workforce', prefix: ['team.', 'chat.', 'docs.', 'learn.'] },
  { key: 'management', prefix: ['quality.', 'insights.'] },
  { key: 'platform', prefix: ['admin.', 'ai.'] },
]

const BASE: Permission[] = ['team.read', 'chat.use', 'docs.read', 'learn.read', 'schedule.read', 'quality.report']
const CARE_ASSIST: Permission[] = [
  ...BASE,
  'resident.read', 'resident.chart.write', 'resident.vitals.write', 'resident.nutrition.write',
  'task.read', 'task.complete', 'handover.read',
]
const CARE_NURSE: Permission[] = [
  ...CARE_ASSIST,
  'resident.careplan.edit', 'resident.assessment.write', 'resident.wounds.write',
  'resident.medication.read', 'resident.medication.administer', 'resident.medication.doublecheck', 'resident.visit.conduct',
  'task.manage', 'handover.write', 'chat.clinical', 'ai.use',
]
const LEAD: Permission[] = [
  ...CARE_NURSE,
  'resident.create', 'resident.edit', 'resident.chart.correct', 'resident.careplan.approve',
  'schedule.manage', 'team.post', 'quality.manage', 'insights.view',
]

/** Standardrollen nach PRD §34. Organisationen können sie anpassen oder eigene anlegen. */
export const DEFAULT_ROLES: { key: string; name: string; permissions: Permission[] }[] = [
  { key: 'care_assistant', name: 'Pflegehelfer/in', permissions: CARE_ASSIST },
  { key: 'nurse', name: 'Pflegefachperson', permissions: CARE_NURSE },
  { key: 'specialist', name: 'Fachverantwortung', permissions: [...CARE_NURSE, 'resident.careplan.approve', 'resident.chart.correct', 'docs.manage', 'learn.manage'] },
  { key: 'ward_lead', name: 'Stationsleitung', permissions: LEAD },
  { key: 'nursing_director', name: 'Pflegedienstleitung', permissions: [...LEAD, 'team.moderate', 'docs.manage', 'docs.approve', 'learn.manage', 'admin.audit'] },
  { key: 'physician', name: 'Arzt/Ärztin', permissions: [...BASE, 'resident.read', 'resident.chart.write', 'resident.medication.read', 'resident.medication.edit', 'resident.careplan.approve', 'resident.visit.conduct', 'handover.read', 'chat.clinical'] },
  { key: 'therapy', name: 'Therapie', permissions: [...BASE, 'resident.read', 'resident.chart.write', 'resident.assessment.write', 'task.read', 'task.complete'] },
  { key: 'administration', name: 'Administration', permissions: [...BASE, 'resident.create', 'resident.edit', 'team.post'] },
  { key: 'hr', name: 'HR', permissions: [...BASE, 'schedule.manage', 'learn.manage', 'team.post', 'admin.users', 'insights.view'] },
  { key: 'quality', name: 'Qualitätsmanagement', permissions: [...BASE, 'resident.read', 'quality.manage', 'insights.view', 'docs.manage', 'docs.approve', 'admin.audit'] },
  { key: 'sysadmin', name: 'Systemadministration', permissions: ALL_PERMISSIONS },
]

export type Grant = { permissions: string[]; locationId: string | null; unitId: string | null }

/**
 * Prüft eine Berechtigung, optional bezogen auf einen Bereich.
 * Eine Rolle ohne Geltungsbereich gilt organisationsweit; mit Standort für alle Bereiche dieses Standorts.
 */
export function hasPermission(grants: Grant[], perm: Permission, scope?: { unitId?: string | null; locationId?: string | null }) {
  return grants.some((g) => {
    if (!g.permissions.includes(perm)) return false
    if (!scope || (!g.unitId && !g.locationId)) return true
    if (g.unitId) return g.unitId === scope.unitId
    if (g.locationId) return g.locationId === scope.locationId
    return true
  })
}
