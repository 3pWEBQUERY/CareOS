"use client";

import { useState } from "react";
import Image from "next/image";
import type { ResidentRecordData } from "./resident-record-data";
import {
  ArrowsLeftRight,
  Bell,
  Buildings,
  CalendarDots,
  CaretDown,
  CaretRight,
  ChartBar,
  ChatsCircle,
  Check,
  ClipboardText,
  Files,
  FirstAidKit,
  ForkKnife,
  Funnel,
  GearSix,
  GraduationCap,
  Heartbeat,
  House,
  ListChecks,
  MagnifyingGlass,
  NotePencil,
  Pill,
  Plus,
  Pulse,
  ShieldCheck,
  SidebarSimple,
  Sparkle,
  Stethoscope,
  UsersThree,
  Warning,
  X,
} from "@phosphor-icons/react";

export type IconName =
  | "home"
  | "residents"
  | "tasks"
  | "handover"
  | "calendar"
  | "team"
  | "learn"
  | "docs"
  | "chart"
  | "quality"
  | "settings"
  | "search"
  | "bell"
  | "building"
  | "chevron"
  | "caretDown"
  | "alert"
  | "check"
  | "plus"
  | "pulse"
  | "close"
  | "note"
  | "vitals"
  | "plan"
  | "med"
  | "wounds"
  | "nutrition"
  | "assess"
  | "shift"
  | "ai"
  | "sidebar"
  | "filter";

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const icons = {
    home: House,
    residents: UsersThree,
    tasks: ListChecks,
    handover: ArrowsLeftRight,
    calendar: CalendarDots,
    team: ChatsCircle,
    learn: GraduationCap,
    docs: Files,
    chart: ChartBar,
    quality: ShieldCheck,
    settings: GearSix,
    search: MagnifyingGlass,
    bell: Bell,
    building: Buildings,
    chevron: CaretRight,
    caretDown: CaretDown,
    alert: Warning,
    check: Check,
    plus: Plus,
    pulse: Pulse,
    close: X,
    note: NotePencil,
    vitals: Heartbeat,
    plan: ClipboardText,
    med: Pill,
    wounds: FirstAidKit,
    nutrition: ForkKnife,
    assess: Stethoscope,
    shift: Heartbeat,
    ai: Sparkle,
    sidebar: SidebarSimple,
    filter: Funnel,
  };
  const Component = icons[name];
  return <Component className={className} aria-hidden="true" weight="regular" />;
}

export type ResidentRow = {
  id: string;
  first_name: string;
  last_name: string;
  gender: string | null;
  room: string;
  care_unit: string;
  care_level: string;
  note: string;
  last_update: string;
  severity: string;
  admitted_on: string | null;
  status: string;
  has_photo: boolean;
  photo_updated_at: string | null;
};

export const residentStatusFilters = [
  "Alle",
  "Aktiv",
  "Eintritt geplant",
  "Verlegt",
  "Ausgetreten",
  "Verstorben",
  "Archiviert",
] as const;

export const residentStatusValues: Record<Exclude<ResidentStatusFilter, "Alle">, string> = {
  Aktiv: "active",
  "Eintritt geplant": "planned",
  Verlegt: "transferred",
  Ausgetreten: "discharged",
  Verstorben: "deceased",
  Archiviert: "archived",
};

export function toResident(row: ResidentRow): ResidentRecordData {
  const status = (
    ["critical", "attention", "info", "stable"].includes(row.severity) ? row.severity : "stable"
  ) as ResidentRecordData["status"];
  return {
    id: row.id,
    photoUrl: row.has_photo
      ? `/api/residents/${row.id}/photo?format=raw&v=${encodeURIComponent(row.photo_updated_at ?? "")}`
      : undefined,
    initials: `${row.first_name[0] ?? ""}${row.last_name[0] ?? ""}`,
    name: `${row.first_name} ${row.last_name}`,
    gender: row.gender,
    room: row.room || "Zimmer offen",
    unit: row.care_unit || "Nicht zugewiesen",
    careLevel: row.care_level || "Noch offen",
    note: row.note,
    lastUpdate: new Date(row.last_update).toLocaleDateString("de-CH"),
    status,
    lifecycleStatus: row.status,
    statusLabel: { critical: "Kritisch", attention: "Beobachten", info: "Aktualisiert", stable: "Stabil" }[status],
  };
}

export function ResidentAvatar({ resident }: { resident: ResidentRecordData }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  return (
    <span className={`resident-avatar ${resident.status === "critical" ? "critical" : ""}`}>
      {resident.photoUrl && !photoFailed ? (
        <Image
          className="resident-avatar-image"
          src={resident.photoUrl}
          alt=""
          fill
          sizes="40px"
          unoptimized
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        resident.initials
      )}
    </span>
  );
}

export type ResidentStatusFilter = (typeof residentStatusFilters)[number];
