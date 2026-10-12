// Quality management (events and improvement actions), shared by the API and the client.

export const EVENT_TYPES = [
  "Sturz",
  "Medikation",
  "Dekubitus",
  "Hygiene / Infektion",
  "Freiheitsbeschränkende Massnahme",
  "Aggression / Gewalt",
  "Beschwerde",
  "Lob",
  "Sonstiges",
] as const;

export const SEVERITIES = {
  info: { label: "Gering", tone: "info" },
  attention: { label: "Mittel", tone: "attention" },
  critical: { label: "Kritisch", tone: "critical" },
} as const;
export type Severity = keyof typeof SEVERITIES;

export const EVENT_STATUS = {
  open: { label: "Neu gemeldet", tone: "critical" },
  investigating: { label: "In Prüfung", tone: "attention" },
  resolved: { label: "Massnahmen umgesetzt", tone: "info" },
  closed: { label: "Abgeschlossen", tone: "stable" },
} as const;
export type EventStatus = keyof typeof EVENT_STATUS;

export const ACTION_STATUS = {
  open: { label: "Offen", tone: "attention" },
  planned: { label: "Geplant", tone: "info" },
  done: { label: "Erledigt", tone: "stable" },
  cancelled: { label: "Verworfen", tone: "info" },
} as const;
export type ActionStatus = keyof typeof ACTION_STATUS;

export const EFFECTIVENESS = {
  effective: "Wirksam",
  partially: "Teilweise wirksam",
  not_effective: "Nicht wirksam",
} as const;
export type Effectiveness = keyof typeof EFFECTIVENESS;

export type QualityEvent = {
  id: string;
  title: string;
  type: string;
  severity: Severity;
  status: EventStatus;
  occurredAt: string;
  description: string;
  immediateAction: string | null;
  residentId: string | null;
  residentName: string | null;
  careUnitId: string | null;
  careUnit: string | null;
  reportedBy: string | null;
  ownerId: string | null;
  ownerName: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  actions: number;
  openActions: number;
  // Folgeaufgaben aus der Ablaufkette der Ereignisart.
  followUps: number;
  followUpsDone: number;
};

export type QualityAction = {
  id: string;
  title: string;
  description: string | null;
  eventId: string | null;
  eventTitle: string | null;
  careUnit: string | null;
  ownerId: string | null;
  ownerName: string | null;
  dueOn: string | null;
  overdue: boolean;
  status: ActionStatus;
  effectiveness: Effectiveness | null;
  completionNote: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type Option = { id: string; name: string; detail?: string };

export type EventStats = {
  thisYear: number;
  lastYearSamePeriod: number;
  criticalOpen: number;
  investigating: number;
  newToday: number;
  closedShare: number | null;
};

export type ActionStats = {
  active: number;
  overdue: number;
  owners: number;
  doneThisYear: number;
  effectiveShare: number | null;
};

export type QualityEventsPayload = {
  events: QualityEvent[];
  stats: EventStats;
  residents: Option[];
  careUnits: Option[];
  staff: Option[];
  canManage: boolean;
  // Ablaufketten je Ereignisart (Schrittanzahl), damit die Meldung zeigt, was daraus entsteht.
  workflowSteps: Record<string, number>;
  // Eingebaute und eigene Ereignisarten der Einrichtung.
  eventTypes: { builtIn: string[]; custom: string[] };
};

export type QualityActionsPayload = {
  actions: QualityAction[];
  stats: ActionStats;
  events: Option[];
  careUnits: Option[];
  staff: Option[];
  canManage: boolean;
};
