// Learning definitions shared by the API and the client workspace.

export const TRAINING_CATEGORIES = [
  "Pflege",
  "Medikation",
  "Wundmanagement",
  "Hygiene",
  "Notfall",
  "Sicherheit",
  "Kommunikation",
  "Organisation",
] as const;

export const TRAINING_FORMATS = {
  elearning: "E-Learning",
  presence: "Präsenz",
  external: "Extern",
} as const;
export type TrainingFormat = keyof typeof TRAINING_FORMATS;

export const CERTIFICATE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

// Evidence that expires within this many days counts as "due soon".
export const DUE_SOON_DAYS = 60;

export type TrainingSession = {
  id: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  capacity: number | null;
  booked: number;
  mine: boolean;
};

export type Enrollment = {
  id: string;
  trainingId: string;
  userId: string;
  userName: string;
  status: "assigned" | "in_progress" | "completed";
  progress: number;
  dueOn: string | null;
  sessionId: string | null;
  completedAt: string | null;
  validUntil: string | null;
  verified: boolean;
  verifiedByName: string | null;
  certificateFileId: string | null;
  certificateName: string | null;
  note: string | null;
  assignedByName: string | null;
  quizScore: number | null;
  quizPassedAt: string | null;
};

// Quiz: Einzelauswahl je Frage. Die richtige Antwort erhält nur die Leitung (zum Bearbeiten).
export type QuizQuestion = { id: string; question: string; options: string[]; correct: number | null };
export type TrainingQuiz = { passPercent: number; questions: QuizQuestion[] };
export const QUIZ_MAX_QUESTIONS = 30;
export const QUIZ_OPTIONS = { min: 2, max: 6 } as const;
export type QuizResult = { correct: number; total: number; percent: number; passPercent: number; passed: boolean };

// Bestanden, sobald der Anteil richtiger Antworten die von der Einrichtung gesetzte Grenze erreicht.
// Die Prozentanzeige wird abgerundet, damit sie das Ergebnis nie besser darstellt.
export function scoreQuiz(correctOptions: number[], answers: number[], passPercent: number): QuizResult {
  const total = correctOptions.length;
  const correct = correctOptions.filter((option, index) => answers[index] === option).length;
  return {
    correct,
    total,
    percent: total ? Math.floor((correct * 100) / total) : 0,
    passPercent,
    passed: total > 0 && correct * 100 >= passPercent * total,
  };
}

export type Training = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  format: TrainingFormat;
  durationMinutes: number | null;
  mandatory: boolean;
  validForMonths: number | null;
  requiredRoles: string[];
  linkUrl: string | null;
  quiz: TrainingQuiz | null;
  sessions: TrainingSession[];
  enrollment: Enrollment | null;
  enrolledCount: number;
};

export type ComplianceState = "valid" | "due_soon" | "expired" | "missing" | "pending";

export const COMPLIANCE_STATES: Record<ComplianceState, { label: string; tone: string }> = {
  valid: { label: "Gültig", tone: "stable" },
  due_soon: { label: "Bald fällig", tone: "attention" },
  expired: { label: "Abgelaufen", tone: "critical" },
  missing: { label: "Offen", tone: "critical" },
  pending: { label: "Prüfung ausstehend", tone: "info" },
};

export type ComplianceRow = {
  key: string;
  trainingId: string;
  title: string;
  description: string | null;
  category: string;
  userId: string;
  userName: string;
  state: ComplianceState;
  deadline: string | null;
  enrollment: Enrollment | null;
};

export type LearningPerson = {
  id: string;
  name: string;
  role: string;
  jobTitle: string;
  unitId: string | null;
  unitName: string | null;
};

export type LearningPayload = {
  today: string;
  trainings: Training[];
  compliance: ComplianceRow[];
  people: LearningPerson[];
  roles: Array<{ key: string; name: string }>;
  canManage: boolean;
  currentUserId: string;
};
