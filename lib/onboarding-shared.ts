// Einarbeitung neuer Mitarbeitender (Server und Oberfläche). Die Punkte je Rolle legt die Einrichtung fest.

export const ONBOARDING_ITEMS_MAX = 60;
// Schlüssel der Punkte, die für alle Rollen gelten.
export const ALL_ROLES = "";

export type OnboardingStep = {
  id: string;
  title: string;
  done: { at: string; by: string | null } | null;
  note: string;
};

export type Onboarding = {
  id: string;
  userId: string;
  userName: string;
  roleName: string;
  mentorId: string | null;
  mentorName: string | null;
  startedOn: string;
  note: string;
  completed: { at: string; by: string | null } | null;
  steps: OnboardingStep[];
  // Darf die angemeldete Person Punkte abzeichnen (Leitung oder einarbeitende Person)?
  canSign: boolean;
};

export type OnboardingStaff = { id: string; name: string; roleKey: string; roleName: string };

export type OnboardingOverview = {
  canManage: boolean;
  roles: Array<{ key: string; name: string }>;
  checklists: Record<string, string[]>;
  staff: OnboardingStaff[];
  onboardings: Onboarding[];
};
