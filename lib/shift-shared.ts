// Shift definitions shared by the API and the client workspace.

// Local start/end times per shift type; an end before the start lies on the next day.
export const SHIFT_TYPES = {
  Frühdienst: { start: "07:00", end: "15:30" },
  Tagdienst: { start: "08:00", end: "16:30" },
  Spätdienst: { start: "13:30", end: "22:00" },
  Nachtwache: { start: "21:45", end: "07:15" },
} as const;
export type ShiftType = keyof typeof SHIFT_TYPES;

export const CHECKLIST = {
  handover: "Übergabe geprüft",
  medcart: "Medikationswagen übernommen",
  phone: "Notfalltelefon geprüft",
} as const;
export type ChecklistKey = keyof typeof CHECKLIST;

export const HANDOVER_STATUS = {
  complete: "Übergabe vollständig gelesen",
  partial: "Übergabe teilweise gelesen",
  pending: "Übergabe ausstehend",
} as const;
export type HandoverStatus = keyof typeof HANDOVER_STATUS;

export type Tone = "stable" | "attention" | "critical" | "info";

export type MyShift = {
  assignmentId: string;
  shiftId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  careUnitId: string | null;
  careUnit: string | null;
  role: string | null;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
};

export type TimelineItem = {
  id: string;
  kind: "task" | "medication" | "wound" | "appointment";
  at: string;
  title: string;
  detail: string;
  tone: Tone;
  done: boolean;
  overdue: boolean;
  href: string;
  taskId?: string;
  documentOnCompletion?: boolean;
};

export type ShiftHint = { id: string; tone: Tone; title: string; text: string; href: string };

export type ShiftOverview = {
  current: MyShift | null;
  next: MyShift | null;
  window: { from: string; to: string; label: string };
  careUnit: { id: string | null; name: string };
  timeline: TimelineItem[];
  hints: ShiftHint[];
  stats: { residents: number; tasks: number; done: number; total: number; staffPresent: number; staffPlanned: number };
  careUnits: Array<{ id: string; name: string }>;
  unreadHandover: number;
  openTasks: number;
};

export type ShiftPulse = {
  label: string;
  detail: string;
  residents: number;
  openTasks: number;
  staffPresent: number;
  staffPlanned: number;
};

export type ShiftHistoryEntry = {
  assignmentId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  careUnit: string | null;
  status: "completed" | "open" | "absent";
  handoverStatus: HandoverStatus | null;
  checklist: ChecklistKey[];
  checkInNote: string | null;
  checkOutNote: string | null;
  counts: { documentation: number; vitals: number; medication: number; tasks: number; handover: number };
};

export type ShiftHistory = {
  entries: ShiftHistoryEntry[];
  totals: { shifts: number; completed: number; documentation: number; open: number };
};
