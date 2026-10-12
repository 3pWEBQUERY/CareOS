"use client";

import type { RepresentativeRole } from "@/lib/advance-care-shared";

export type ResidentRecordData = {
  id?: string;
  photoUrl?: string;
  gender?: string | null;
  initials: string;
  name: string;
  room: string;
  unit: string;
  careLevel: string;
  note: string;
  lastUpdate: string;
  status: "critical" | "attention" | "info" | "stable";
  lifecycleStatus: string;
  statusLabel: string;
};

export type ResidentRecordProps = {
  resident: ResidentRecordData;
  onClose: () => void;
  onAction: (message: string) => void;
  onGenderChanged?: (residentId: string, gender: string) => void;
  onPhotoChanged?: () => void;
  initialView?: RecordView;
  onViewChange?: (view: RecordView) => void;
  // Stepping through the residents of the list the record was opened from.
  navigation?: { position: number; total: number; onPrevious: () => void; onNext: () => void };
};

export type RecordView =
  | "overview"
  | "master-data"
  | "documentation"
  | "care-record"
  | "supplies"
  | "appointments"
  | "history"
  | "documents"
  | "biography"
  | "restraints";

export type DocumentationFlag = "important" | "visit" | "observation" | "handover";

export type HistoryFilter = "Alle" | "Pflege" | "Vitalwerte" | "Medikation" | "Termine";

export type DocumentationEntry = {
  id: string;
  time: string;
  title: string;
  text: string;
  author: string;
  category: string;
};

export type CareDomain = {
  id: string;
  label: string;
  status: "critical" | "attention" | "info" | "stable";
  statusLabel: string;
  summary: string;
  goal: string;
  measures: string[];
  targetDate: string | null;
};

export type BodyObservation = {
  id: string;
  kind: "redness" | "wound" | "fracture" | "other";
  label: string;
  location: string;
  status: string;
  notes: string;
  created_at: string;
  author: string;
  body_x: number;
  body_y: number;
  body_z: number;
  wound_id?: string | null;
};

export type ObservationDraft = {
  kind: BodyObservation["kind"];
  label: string;
  location: string;
  status: string;
  notes: string;
  x: number;
  y: number;
  z: number;
};

export type HistoryEntry = {
  id: string;
  date: string;
  time: string;
  occurredAt: string;
  category: Exclude<HistoryFilter, "Alle">;
  title: string;
  description: string;
  author: string;
  tone: "critical" | "attention" | "info" | "stable";
  documentationId?: string;
};

export const recordTabs = [
  "Übersicht",
  "Stammdaten",
  "Biografie",
  "Termine",
  "Dokumentation",
  "Pflegeakte",
  "Pflegebedarf",
  "Verlauf",
  "Dokumente",
  "FBM",
];

export type ResidentBiography = {
  lifeStory: string;
  importantPeople: string;
  dailyRoutines: string;
  preferences: string;
  strengths: string;
  sensitiveTopics: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type ResidentContact = {
  id: string;
  full_name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  is_emergency_contact: boolean;
  representative_role: RepresentativeRole | null;
  updated_at: string;
};

export type ContactDraft = {
  fullName: string;
  relationship: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  isEmergencyContact: boolean;
  representativeRole: RepresentativeRole | null;
};

export const emptyBiography: ResidentBiography = {
  lifeStory: "",
  importantPeople: "",
  dailyRoutines: "",
  preferences: "",
  strengths: "",
  sensitiveTopics: "",
  updatedAt: null,
  updatedBy: null,
};

export const emptyContact: ContactDraft = {
  fullName: "",
  relationship: "",
  phone: "",
  email: "",
  isPrimary: false,
  isEmergencyContact: true,
  representativeRole: null,
};

export type CareSupplyProduct = {
  id: string;
  item_name: string;
  category: string;
  unit: string;
  default_target_quantity: number;
};

export type ResidentSupply = {
  id: string;
  product_id: string | null;
  item_name: string;
  category: string;
  unit: string;
  current_quantity: number;
  target_quantity: number;
  status: "active" | "blocked" | "archived";
  notes: string | null;
  updated_at: string;
};

export type SupplyDraft = {
  productId: string;
  quantity: number;
  itemName: string;
  category: string;
  unit: string;
  currentQuantity: number;
  targetQuantity: number;
  status: "active" | "blocked" | "archived";
  notes: string;
};

export const emptySupply: SupplyDraft = {
  productId: "",
  quantity: 1,
  itemName: "",
  category: "Pflege & Hygiene",
  unit: "Stück",
  currentQuantity: 0,
  targetQuantity: 0,
  status: "active",
  notes: "",
};
