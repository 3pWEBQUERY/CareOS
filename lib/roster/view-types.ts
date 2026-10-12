// Antworten der Dienstplan-Endpunkte für die Oberfläche (auch im Browser geladen).
import type {
  AbsenceKind,
  ExclusionCategory,
  PeriodStatus,
  Priority,
  RuleSet,
  ShiftCategory,
  ShiftSource,
  ShiftTypeInfo,
  TimeEntryStatus,
  TimeOffStatus,
  Violation,
} from "./types";

export type UnitOption = { id: string; name: string; site: string; lead: boolean };

export type GridDay = { date: string; weekday: number; weekend: boolean; holiday: string | null; today: boolean };

export type GridEmployee = {
  id: string;
  name: string;
  pensumPercent: number;
  qualifications: string[];
  excluded: ExclusionCategory[];
  otherUnits: string[];
  targetMinutes: number | null;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  preferences: string[];
  timeOff: Array<{ id: string; startDate: string; endDate: string; status: TimeOffStatus; priority: Priority }>;
  isSelf: boolean;
};

export type GridTimeEntry = {
  id: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  actualMinutes: number | null;
  status: TimeEntryStatus;
  differenceMinutes: number | null;
  startDeviationMinutes: number;
  endDeviationMinutes: number | null;
};

export type GridShift = {
  id: string;
  employeeId: string;
  unitId: string;
  shiftTypeId: string | null;
  code: string;
  name: string;
  color: string;
  category: ShiftCategory;
  absenceKind: AbsenceKind | null;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  breakMinutes: number;
  netMinutes: number;
  source: ShiftSource;
  notes: string | null;
  version: number;
  swapped: { with: string; at: string | null } | null;
  entry: GridTimeEntry | null;
  violations: Violation[];
  // Abwesenheiten anderer Personen ohne Grund ("Abwesend"), Spec 6.3.
  masked: boolean;
};

export type StaffingCell = {
  date: string;
  shiftTypeId: string;
  count: number;
  min: number | null;
  max: number | null;
  qualified: number | null;
  minQualified: number | null;
};

export type ScheduleTiles = {
  employees: number;
  shiftsToday: number;
  openTimeOff: number;
  openSwaps: number;
  deviations: number;
  understaffedDays: number;
  targetDeviations: number;
};

export type SchedulePayload = {
  unit: { id: string; name: string };
  units: UnitOption[];
  year: number;
  month: number;
  today: string;
  timezone: string;
  lead: boolean;
  period: {
    id: string;
    status: PeriodStatus;
    publishedAt: string | null;
    lockedAt: string | null;
    version: number;
  } | null;
  canEdit: boolean;
  days: GridDay[];
  employees: GridEmployee[];
  shiftTypes: ShiftTypeInfo[];
  shifts: GridShift[];
  staffing: StaffingCell[];
  violations: Violation[];
  tiles: ScheduleTiles | null;
  ruleSet: Pick<RuleSet, "valuesConfirmed" | "autoSwapApproval" | "allowShiftTakeover" | "deviationThresholdMinutes">;
  aiAvailable: boolean;
  // Leitung: aktive Personen des Hauses, die (noch) nicht in diesem Wohnbereich planbar sind.
  candidates: Array<{ id: string; name: string; detail: string | null }>;
  changeToken: string;
};

export type CommitResult = { violations: Violation[]; shiftIds: string[] };
