/**
 * Sichtbarkeit im Personenverzeichnis und Mitarbeiterprofil (PRD §55, §36) – rein und testbar.
 *
 * Für alle mit team.read: Name, Funktion, Bereich, Rollen, Qualifikationen (ohne Ablaufdaten), dienstliche
 * Kontaktangaben, Dienst heute (mit schedule.read), «abwesend» ohne Grund.
 * Zusätzlich für die Person selbst und für Leitungen/HR mit Zuständigkeit für die Person:
 * private Nummer, Abwesenheitsgrund, Gültigkeit von Qualifikationen, Zertifikate und Schulungsstand.
 * Die private Nummer sehen alle anderen nur, wenn die Person sie selbst freigibt (User.phoneShared).
 */
import { hasPermission, type Grant, type Permission } from './permissions'

/** Bereiche einer Person: Stammbereich und Bereiche/Standorte ihrer Rollen. */
export type PersonScope = { unitIds: string[]; locationIds: string[]; orgWide: boolean }

/**
 * Hat jemand mit diesen Rechten eine Berechtigung für die Person? Organisationsweite Rechte gelten immer;
 * bereichsbezogene nur, wenn sie einen Bereich (oder Standort) der Person abdecken. Personen ohne Bereich
 * (z. B. HR, Qualitätsmanagement) betreffen nur organisationsweite Rechte.
 */
export function responsibleFor(grants: Grant[], perm: Permission, person: PersonScope, unitLocation: (unitId: string) => string | undefined) {
  if (grants.some((g) => !g.unitId && !g.locationId && g.permissions.includes(perm))) return true
  for (const unitId of person.unitIds) if (hasPermission(grants, perm, { unitId, locationId: unitLocation(unitId) ?? null })) return true
  for (const locationId of person.locationIds) if (grants.some((g) => g.permissions.includes(perm) && g.locationId === locationId)) return true
  return false
}

export type ProfileAccess = {
  self: boolean
  /** Leitung/HR: Dienstplan, Schulungen oder Benutzerverwaltung für diese Person */
  manager: boolean
  privatePhone: boolean
  absenceReason: boolean
  qualificationValidity: boolean
  training: boolean
  shifts: boolean
  adminLink: boolean
}

export function profileAccess(opts: {
  viewerId: string
  personId: string
  grants: Grant[]
  person: PersonScope
  phoneShared: boolean
  unitLocation: (unitId: string) => string | undefined
}): ProfileAccess {
  const self = opts.viewerId === opts.personId
  const r = (p: Permission) => responsibleFor(opts.grants, p, opts.person, opts.unitLocation)
  const hr = r('admin.users')
  const schedule = r('schedule.manage')
  const learn = r('learn.manage')
  const manager = hr || schedule || learn
  const canSchedule = opts.grants.some((g) => g.permissions.includes('schedule.read'))
  return {
    self,
    manager,
    privatePhone: self || opts.phoneShared || hr || schedule,
    absenceReason: self || hr || schedule,
    qualificationValidity: self || manager,
    training: self || learn || hr,
    shifts: self || canSchedule,
    adminLink: hr && !self,
  }
}
