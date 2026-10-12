// Rückmeldungen und Beschwerden (Server und Oberfläche). Die Antwortfrist legt die Einrichtung fest.

export const FEEDBACK_KINDS = { complaint: "Beschwerde", suggestion: "Anregung", praise: "Lob" } as const;
export type FeedbackKind = keyof typeof FEEDBACK_KINDS;

export const FEEDBACK_SOURCES = {
  relative: "Angehörige",
  resident: "Bewohnende",
  visitor: "Besuch",
  staff: "Mitarbeitende",
  other: "Andere",
} as const;
export type FeedbackSource = keyof typeof FEEDBACK_SOURCES;

export const FEEDBACK_CHANNELS = {
  in_person: "Persönlich",
  phone: "Telefon",
  email: "E-Mail",
  letter: "Brief",
  other: "Anderer Weg",
} as const;
export type FeedbackChannel = keyof typeof FEEDBACK_CHANNELS;

export const FEEDBACK_STATUSES = {
  open: "Offen",
  in_progress: "In Bearbeitung",
  answered: "Beantwortet",
  closed: "Abgeschlossen",
} as const;
export type FeedbackStatus = keyof typeof FEEDBACK_STATUSES;

export const FEEDBACK_RESPONSE_DAYS_MAX = 365;

export type Feedback = {
  id: string;
  kind: FeedbackKind;
  source: FeedbackSource;
  sourceName: string;
  contact: string;
  channel: FeedbackChannel;
  residentId: string | null;
  residentName: string | null;
  careUnitId: string | null;
  careUnitName: string | null;
  topic: string;
  description: string;
  receivedOn: string;
  dueOn: string | null;
  // Frist der Einrichtung abgelaufen und noch nicht beantwortet bzw. abgeschlossen.
  overdue: boolean;
  assignedTo: string | null;
  assignedName: string | null;
  status: FeedbackStatus;
  measures: string;
  response: string;
  answeredOn: string | null;
  answeredBy: string | null;
  closed: { at: string; by: string | null } | null;
  recordedBy: string | null;
  // Darf die angemeldete Person bearbeiten und beantworten (Qualitätsmanagement oder zuständig)?
  canEdit: boolean;
};

export type FeedbackEvaluation = {
  year: number;
  total: number;
  byKind: Record<FeedbackKind, number>;
  bySource: Record<FeedbackSource, number>;
  byTopic: Array<{ topic: string; complaint: number; suggestion: number; praise: number }>;
  byMonth: number[];
  answered: number;
  // Beantwortet innerhalb der Frist (nur Rückmeldungen mit Frist).
  answeredInTime: number;
  withDeadline: number;
  // Median der Tage bis zur Antwort; null ohne Antworten.
  medianDays: number | null;
};

export type FeedbackOverview = {
  canManage: boolean;
  today: string;
  responseDays: number | null;
  items: Feedback[];
  topics: string[];
  residents: Array<{ id: string; name: string }>;
  careUnits: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
  evaluation: FeedbackEvaluation;
};
