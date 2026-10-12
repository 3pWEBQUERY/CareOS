// Dienstplan-Modul: gemeinsame Typen und Konstanten für Server, Regel-Engine und Oberfläche.
// Keine Imports mit Seiteneffekten – diese Datei wird auch im Browser und in Tests geladen.

export type ShiftCategory = "WORK" | "STANDBY" | "ON_CALL" | "ABSENCE";
export type AbsenceKind = "VACATION" | "SICK" | "TRAINING" | "OTHER";
// Was eine Person ausschliessen kann (ohne Begründung): Nachtdienste, Bereitschaft, Rufbereitschaft.
export type ExclusionCategory = "NIGHT" | "STANDBY" | "ON_CALL";
export type PeriodStatus = "DRAFT" | "PUBLISHED";
export type ShiftSource = "MANUAL" | "DRAG_DROP" | "AI" | "SWAP" | "SEED" | "IMPORT";
export type Priority = "LOW" | "MEDIUM" | "HIGH";
export type TimeOffStatus = "OPEN" | "APPROVED" | "REJECTED" | "WITHDRAWN";
export type PreferenceKind =
  "PREFER_SHIFT_TYPE" | "AVOID_SHIFT_TYPE" | "PREFER_WEEKDAY" | "AVOID_WEEKDAY" | "AVOID_CATEGORY";
export type SwapStatus =
  "PENDING_TARGET" | "PENDING_APPROVAL" | "EXECUTED" | "DECLINED" | "WITHDRAWN" | "EXPIRED" | "REJECTED" | "FAILED";
export type TimeEntryStatus = "OPEN" | "COMPLETE" | "INCOMPLETE" | "APPROVED";
export type AuditSource = "UI" | "SWAP" | "AI" | "SYSTEM" | "SEED" | "IMPORT";

export const CATEGORY_LABELS: Record<ShiftCategory, string> = {
  WORK: "Arbeitsdienst",
  STANDBY: "Bereitschaft",
  ON_CALL: "Rufbereitschaft",
  ABSENCE: "Abwesenheit",
};
export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  VACATION: "Urlaub",
  SICK: "Krank",
  TRAINING: "Fortbildung",
  OTHER: "Abwesend",
};
export const EXCLUSION_LABELS: Record<ExclusionCategory, string> = {
  NIGHT: "Nachtdienste",
  STANDBY: "Bereitschaft",
  ON_CALL: "Rufbereitschaft",
};
export const PRIORITY_LABELS: Record<Priority, string> = { LOW: "Niedrig", MEDIUM: "Mittel", HIGH: "Hoch" };
export const TIME_OFF_STATUS_LABELS: Record<TimeOffStatus, string> = {
  OPEN: "Offen",
  APPROVED: "Genehmigt",
  REJECTED: "Abgelehnt",
  WITHDRAWN: "Zurückgezogen",
};
export const SWAP_STATUS_LABELS: Record<SwapStatus, string> = {
  PENDING_TARGET: "Wartet auf Antwort",
  PENDING_APPROVAL: "Wartet auf Genehmigung",
  EXECUTED: "Getauscht",
  DECLINED: "Abgelehnt",
  WITHDRAWN: "Zurückgezogen",
  EXPIRED: "Abgelaufen",
  REJECTED: "Von Leitung abgelehnt",
  FAILED: "Fehlgeschlagen",
};
export const OPEN_SHIFT_STATUS_LABELS: Record<"OPEN" | "ASSIGNED" | "DECLINED" | "WITHDRAWN" | "CLOSED", string> = {
  OPEN: "Interesse gemeldet",
  ASSIGNED: "Zugeteilt",
  DECLINED: "Nicht zugeteilt",
  WITHDRAWN: "Zurückgezogen",
  CLOSED: "Anderweitig besetzt",
};
export const TIME_ENTRY_STATUS_LABELS: Record<TimeEntryStatus, string> = {
  OPEN: "Läuft",
  COMPLETE: "Erfasst",
  INCOMPLETE: "Unvollständig",
  APPROVED: "Freigegeben",
};
export const PREFERENCE_LABELS: Record<PreferenceKind, string> = {
  PREFER_SHIFT_TYPE: "Bevorzugter Diensttyp",
  AVOID_SHIFT_TYPE: "Diensttyp vermeiden",
  PREFER_WEEKDAY: "Bevorzugter Wochentag",
  AVOID_WEEKDAY: "Wochentag vermeiden",
  AVOID_CATEGORY: "Dienstart vermeiden",
};
export const WEEKDAY_LABELS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export type BreakRule = { minWorkMinutes: number; minBreakMinutes: number };

export type RuleSet = {
  id: string | null;
  careUnitId: string | null;
  timezone: string;
  weeklyNormMinutes: number;
  minRestMinutes: number;
  maxDailyWorkMinutes: number;
  maxWeeklyWorkMinutes: number;
  maxConsecutiveWorkDays: number;
  breakRules: BreakRule[];
  nightStart: string;
  nightEnd: string;
  deviationThresholdMinutes: number;
  missingClockOutAfterMinutes: number;
  clockInEarliestMinutes: number;
  autoSwapApproval: boolean;
  allowShiftTakeover: boolean;
  aiRunsPerHour: number;
  // False while the values are the unconfirmed examples of the seed ("Beispielwerte – rechtlich prüfen").
  valuesConfirmed: boolean;
};

export type ShiftTypeInfo = {
  id: string;
  careUnitId: string | null;
  name: string;
  code: string;
  category: ShiftCategory;
  absenceKind: AbsenceKind | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  color: string;
  workTimeFactor: number;
  creditsTarget: boolean;
  requiredQualificationIds: string[];
  active: boolean;
  sortOrder: number;
};

export type QualificationGrant = { qualificationId: string; validFrom: string; validUntil: string | null };

export type EmployeeInfo = {
  id: string;
  name: string;
  pensumPercent: number;
  weeklyTargetMinutesOverride: number | null;
  employmentStart: string | null;
  employmentEnd: string | null;
  active: boolean;
  excludedCategories: ExclusionCategory[];
  // Wohnbereiche, in denen die Person eingeplant werden darf.
  unitIds: string[];
  qualifications: QualificationGrant[];
};

export type RosterShift = {
  id: string;
  periodId: string;
  unitId: string;
  employeeId: string;
  shiftTypeId: string;
  category: ShiftCategory;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  breakMinutes: number;
  source: ShiftSource;
  notes: string | null;
  lastSwapId: string | null;
  version: number;
  hasTimeEntry: boolean;
};

export type StaffingRequirement = {
  id: string;
  unitId: string;
  shiftTypeId: string;
  weekday: number | null;
  date: string | null;
  minCount: number;
  maxCount: number | null;
  minQualified: number | null;
  qualificationId: string | null;
};

export type TimeOffRequest = {
  id: string;
  employeeId: string;
  unitId: string;
  startDate: string;
  endDate: string;
  priority: Priority;
  status: TimeOffStatus;
};

export type ShiftPreference = {
  id: string;
  employeeId: string;
  kind: PreferenceKind;
  shiftTypeId: string | null;
  weekday: number | null;
  category: ExclusionCategory | null;
  date: string | null;
  validFrom: string | null;
  validUntil: string | null;
  comment: string | null;
  active: boolean;
};

export type PeriodInfo = {
  id: string;
  unitId: string;
  year: number;
  month: number;
  status: PeriodStatus;
  lockedAt: string | null;
  version: number;
};

export type Severity = "BLOCK" | "WARN" | "INFO";

export const RULE_CODES = [
  "OUT_OF_SCOPE",
  "EMPLOYEE_INACTIVE",
  "OVERLAP",
  "ABSENCE_CONFLICT",
  "APPROVED_TIME_OFF",
  "REST_TIME",
  "QUALIFICATION_MISSING",
  "EXCLUDED_CATEGORY",
  "MAX_DAILY_WORK",
  "PERIOD_LOCKED",
  "SHIFT_HAS_TIME_ENTRY",
  "STALE_VERSION",
  "SWAP_NOT_ALLOWED",
  "MAX_WEEKLY_WORK",
  "MAX_CONSECUTIVE_DAYS",
  "MIN_STAFFING",
  "MIN_QUALIFIED",
  "MAX_STAFFING",
  "OPEN_TIME_OFF_IGNORED",
  "PREFERENCE_IGNORED",
  "TARGET_DEVIATION",
  "UNEVEN_DISTRIBUTION",
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

export type Violation = {
  code: RuleCode;
  severity: Severity;
  message: string;
  employeeId?: string;
  shiftId?: string;
  date?: string;
  meta?: Record<string, unknown>;
};

// Alles, was die Regel-Engine für eine Entscheidung braucht. Dienste enthalten die Randtage
// (Vor- und Folgemonat) und alle Wohnbereiche der betroffenen Personen.
export type ScheduleSnapshot = {
  unitId: string;
  ruleSet: RuleSet;
  now: string;
  periods: PeriodInfo[];
  shifts: RosterShift[];
  employees: Record<string, EmployeeInfo>;
  shiftTypes: Record<string, ShiftTypeInfo>;
  staffing: StaffingRequirement[];
  timeOff: TimeOffRequest[];
  preferences: ShiftPreference[];
  holidays: string[];
  qualificationNames: Record<string, string>;
  // Wohnbereiche, die die handelnde Person planen darf.
  managedUnitIds: string[];
};

export type NewShiftInput = {
  id: string;
  unitId: string;
  employeeId: string;
  shiftTypeId: string;
  date: string;
  plannedStart?: string;
  plannedEnd?: string;
  breakMinutes?: number;
  notes?: string | null;
};

export type ShiftPatch = {
  employeeId?: string;
  shiftTypeId?: string;
  date?: string;
  plannedStart?: string;
  plannedEnd?: string;
  breakMinutes?: number;
  notes?: string | null;
};

export type ShiftChange =
  | { kind: "create"; shift: NewShiftInput }
  | { kind: "update"; shiftId: string; expectedVersion: number; patch: ShiftPatch }
  | { kind: "move"; shiftId: string; expectedVersion: number; employeeId: string; date: string }
  | { kind: "delete"; shiftId: string; expectedVersion: number }
  | {
      kind: "swap";
      sourceShiftId: string;
      sourceVersion: number;
      targetEmployeeId: string;
      targetShiftId: string | null;
      targetVersion: number | null;
    };

// Stored with the prefix "shift_" so they belong to the "Dienstplan" category of the
// personal notification settings.
export const NOTIFICATION_TYPES = [
  "TIME_OFF_REQUESTED",
  "TIME_OFF_DECIDED",
  "PREFERENCE_SUBMITTED",
  "SWAP_REQUESTED",
  "SWAP_ACCEPTED",
  "SWAP_DECLINED",
  "SWAP_APPROVAL_NEEDED",
  "SWAP_EXECUTED",
  "SWAP_REJECTED",
  "SWAP_FAILED",
  "SHIFT_CHANGED",
  "SHIFT_DELETED",
  "SCHEDULE_PUBLISHED",
  "TIME_DEVIATION",
  "CLOCK_OUT_MISSING",
  "TIME_CORRECTION_REQUESTED",
  "TIME_CORRECTION_DECIDED",
  "STAFFING_PROBLEM",
  "UNPLANNED_WORK",
  "OPEN_SHIFT_INTEREST",
  "OPEN_SHIFT_DECLINED",
  "OPEN_SHIFT_CLOSED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const notificationTypeKey = (type: NotificationType) => `shift_${type.toLowerCase()}`;

// Einheitliches Ergebnis aller Dienstplan-Endpunkte.
export type ActionError = { code: string; message: string; violations?: Violation[] };
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
