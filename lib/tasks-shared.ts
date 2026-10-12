// Task definitions shared by the API and the client workspace.

export const TASK_CATEGORIES = [
  "Pflege",
  "Medikation",
  "Vitalwerte",
  "Dokumentation",
  "Wundmanagement",
  "Ernährung",
  "Organisation",
] as const;

// Documentation category used when a completed task is documented in the care record.
export const TASK_DOC_CATEGORY: Record<string, string> = {
  Pflege: "Pflege",
  Medikation: "Medikation",
  Vitalwerte: "Vitalwerte",
  Dokumentation: "Pflege",
  Wundmanagement: "Wunde",
  Ernährung: "Ernährung",
  Organisation: "Sonstiges",
};

export const TASK_PRIORITIES = {
  low: { label: "Niedrig", tone: "stable" },
  normal: { label: "Normal", tone: "info" },
  high: { label: "Dringend", tone: "attention" },
  critical: { label: "Kritisch", tone: "critical" },
} as const;
export type TaskPriority = keyof typeof TASK_PRIORITIES;

export const TASK_RECURRENCE = { none: "Einmalig", daily: "Täglich", weekly: "Wöchentlich" } as const;
export type TaskRecurrence = keyof typeof TASK_RECURRENCE;

export const TASK_STATUS = {
  open: "Offen",
  in_progress: "In Bearbeitung",
  escalated: "Eskaliert",
  completed: "Erledigt",
  partial: "Teilweise erledigt",
  skipped: "Nicht erledigt",
  cancelled: "Abgebrochen",
} as const;
export type TaskStatus = keyof typeof TASK_STATUS;

// Noch zu erledigen (eskalierte Aufgaben bleiben offen, bis jemand sie abschliesst).
export const ACTIVE_TASK_STATUSES = ["open", "in_progress", "escalated"] as const satisfies readonly TaskStatus[];
export const isActiveTask = (status: TaskStatus) => (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);

// Ergebnis beim Abschluss: ✓ erledigt, △ teilweise, ✕ nicht erledigt. Teilweise und nicht erledigt brauchen eine Begründung.
export const TASK_OUTCOMES = {
  completed: { symbol: "✓", label: "Erledigt" },
  partial: { symbol: "△", label: "Teilweise" },
  skipped: { symbol: "✕", label: "Nicht erledigt" },
} as const;
export type TaskOutcome = keyof typeof TASK_OUTCOMES;

export type Task = {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  overdue: boolean;
  residentId: string | null;
  residentName: string | null;
  room: string | null;
  careUnitId: string | null;
  careUnit: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  createdBy: string | null;
  creatorName: string | null;
  createdAt: string;
  completedAt: string | null;
  completedByName: string | null;
  completionNote: string | null;
  cancelReason: string | null;
  escalatedAt: string | null;
  escalatedByName: string | null;
  escalationReason: string | null;
  teamVisible: boolean;
  remind: boolean;
  documentOnCompletion: boolean;
  recurrence: TaskRecurrence;
  canEdit: boolean;
};

export type TaskPerson = { id: string; name: string; role: string };

export type TasksPayload = {
  tasks: Task[];
  people: TaskPerson[];
  careUnits: Array<{ id: string; name: string }>;
  currentUserId: string;
  canWrite: boolean;
  canManage: boolean;
};

export const personInitials = (name: string | null) =>
  (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
