// Berechtigungen des Dienstplans (Spec Abschnitt 6), abgebildet auf das bestehende Rollensystem.
// Leitung eines Wohnbereichs = Rolle mit "schedule.manage" und Leitungs-Mitgliedschaft im Bereich;
// "administration.manage" leitet alle Wohnbereiche. Mitarbeitende = planbare Mitglieder.

export const ROSTER_PERMISSIONS = [
  "dienstplan:read",
  "dienstplan:read_own",
  "dienstplan:create",
  "dienstplan:update",
  "dienstplan:delete",
  "dienstplan:publish",
  "diensttypen:manage",
  "regelwerk:manage",
  "diensttausch:create",
  "diensttausch:approve",
  "wunschfrei:create",
  "wunschfrei:decide",
  "dienstwunsch:create",
  "zeiterfassung:read",
  "zeiterfassung:read_own",
  "zeiterfassung:write_own",
  "zeiterfassung:update",
  "zeiterfassung:lock",
  "ki:use",
  "audit:read",
] as const;
export type RosterPermission = (typeof ROSTER_PERMISSIONS)[number];

// Wer eine Berechtigung in einem Wohnbereich hat: die Leitung des Bereichs oder jedes Mitglied.
export const PERMISSION_AUDIENCE: Record<RosterPermission, "lead" | "member"> = {
  "dienstplan:read": "lead",
  "dienstplan:read_own": "member",
  "dienstplan:create": "lead",
  "dienstplan:update": "lead",
  "dienstplan:delete": "lead",
  "dienstplan:publish": "lead",
  "diensttypen:manage": "lead",
  "regelwerk:manage": "lead",
  "diensttausch:create": "member",
  "diensttausch:approve": "lead",
  "wunschfrei:create": "member",
  "wunschfrei:decide": "lead",
  "dienstwunsch:create": "member",
  "zeiterfassung:read": "lead",
  "zeiterfassung:read_own": "member",
  "zeiterfassung:write_own": "member",
  "zeiterfassung:update": "lead",
  "zeiterfassung:lock": "lead",
  "ki:use": "lead",
  "audit:read": "lead",
};

export type RosterAccess = {
  userId: string;
  // "administration.manage": leitet alle Wohnbereiche und pflegt organisationsweite Einstellungen.
  isAdmin: boolean;
  // "schedule.manage": darf Wohnbereiche leiten, in denen eine Leitungs-Mitgliedschaft besteht.
  canManage: boolean;
  leadUnitIds: string[];
  memberUnitIds: string[];
  // Alle aktiven Wohnbereiche der Organisation (für Administration).
  allUnitIds: string[];
};

export function managedUnitIds(access: RosterAccess) {
  if (access.isAdmin) return access.allUnitIds;
  return access.canManage ? access.leadUnitIds.filter((id) => access.allUnitIds.includes(id)) : [];
}

export const isLeadOf = (access: RosterAccess, unitId: string) => managedUnitIds(access).includes(unitId);
export const isMemberOf = (access: RosterAccess, unitId: string) => access.memberUnitIds.includes(unitId);

// Organisationsweite Einstellungen (Regelwerk, Diensttypen ohne Wohnbereich) pflegt die Administration;
// für einen Wohnbereich genügt dessen Leitung.
export function rosterCan(access: RosterAccess, permission: RosterPermission, unitId?: string | null) {
  if (!unitId) {
    if (permission === "regelwerk:manage" || permission === "diensttypen:manage") return access.isAdmin;
    return PERMISSION_AUDIENCE[permission] === "lead"
      ? managedUnitIds(access).length > 0
      : access.memberUnitIds.length > 0 || managedUnitIds(access).length > 0;
  }
  if (PERMISSION_AUDIENCE[permission] === "lead") return isLeadOf(access, unitId);
  return isMemberOf(access, unitId) || isLeadOf(access, unitId);
}

// Units whose plan a person may see: led units (full plan, drafts) and member units (published plan).
export const visibleUnitIds = (access: RosterAccess) => [
  ...new Set([...managedUnitIds(access), ...access.memberUnitIds]),
];
