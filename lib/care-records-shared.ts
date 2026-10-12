// Care record (Pflegeakte) definitions shared by the API and the client page.

import type { CarePlan, PlanStatus } from "@/lib/care-planning-shared";

export const RECORD_FILTERS = ["Alle", "Aktuell", "Evaluation fällig", "Entwurf", "Ohne Planung"] as const;
export type RecordFilter = (typeof RECORD_FILTERS)[number];
export type RecordStatus = Exclude<RecordFilter, "Alle">;
export type RecordTone = "stable" | "attention" | "info" | "critical";

export const RECORD_TONES: Record<RecordStatus, RecordTone> = {
  Aktuell: "stable",
  "Evaluation fällig": "attention",
  Entwurf: "info",
  "Ohne Planung": "critical",
};

export type CareRecordRow = {
  id: string;
  name: string;
  initials: string;
  room: string;
  careUnit: string;
  careLevel: string | null;
  planId: string | null;
  planStatus: PlanStatus | null;
  status: RecordStatus;
  focus: string | null;
  ownerName: string | null;
  reviewOn: string | null;
  activeGoals: number;
  activeInterventions: number;
  goalsDue: number;
  risks: number;
};

export type CareRecordFlag = {
  id: string;
  category: string;
  label: string;
  severity: "info" | "attention" | "critical";
  details: string | null;
};

export type CareRecordPerson = { name: string; role: string };

export type CareRecordDetail = {
  plan: CarePlan | null;
  closedPlans: number;
  flags: CareRecordFlag[];
  team: CareRecordPerson[];
};

export type CareRecordsOverview = {
  records: CareRecordRow[];
  staff: Array<{ id: string; name: string }>;
  canWrite: boolean;
};
