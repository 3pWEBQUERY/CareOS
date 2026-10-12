"use client";

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
  FileText,
  Files,
  FirstAidKit,
  ForkKnife,
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
  SignOut,
  Sparkle,
  Stethoscope,
  UsersThree,
  Warning,
  X,
} from "@phosphor-icons/react";
import type { Terms } from "@/lib/terminology";

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
  | "report"
  | "plan"
  | "med"
  | "wounds"
  | "nutrition"
  | "assess"
  | "shift"
  | "ai"
  | "sidebar"
  | "logout";

export type WebMCPContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

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
    report: FileText,
    plan: ClipboardText,
    med: Pill,
    wounds: FirstAidKit,
    nutrition: ForkKnife,
    assess: Stethoscope,
    shift: Heartbeat,
    ai: Sparkle,
    sidebar: SidebarSimple,
    logout: SignOut,
  };
  const Component = icons[name];
  return <Component className={className} aria-hidden="true" weight="regular" />;
}

export type DashboardChange = {
  id: string;
  initials: string;
  name: string;
  note: string;
  time: string;
  status: string;
  type: string;
};

export type DashboardTask = {
  id: string;
  title: string;
  resident: string;
  time: string;
  dueAt: string | null;
  completed: boolean;
  overdue: boolean;
};

export type DashboardResident = {
  id?: string;
  initials: string;
  name: string;
  room: string;
  risk: string;
  critical?: boolean;
};

export type DashboardNote = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  archived_at: string | null;
  updated_at: string;
};

export type ResidentNews = {
  id: string;
  first_name: string;
  last_name: string;
  room: string;
  care_unit_name: string | null;
  title: string | null;
  body: string | null;
  importance: string | null;
  occurred_at: string | null;
  flag_label: string | null;
  flag_severity: string | null;
};

export type DashboardWidgetId =
  | "greeting"
  | "shortcuts"
  | "notes"
  | "today"
  | "news"
  | "summary"
  | "worklist"
  | "critical"
  | "shift"
  | "tasks"
  | "residents";

// Breite im 12er-Raster: Standard (je Baustein), ein Drittel, die Hälfte, zwei Drittel oder volle Breite.
export type DashboardWidgetSize = "third" | "half" | "twoThirds" | "full";
export const DASHBOARD_SIZES: Array<{ id: DashboardWidgetSize; label: string; span: number }> = [
  { id: "third", label: "⅓", span: 4 },
  { id: "half", label: "½", span: 6 },
  { id: "twoThirds", label: "⅔", span: 8 },
  { id: "full", label: "Voll", span: 12 },
];

// `top`: steht standardmässig im Kopfbereich (in der Begrüssung). `span`: Standardbreite im 12er-Raster.
export const dashboardWidgets: Array<{
  id: DashboardWidgetId;
  label: string;
  description: string;
  span: number;
  top?: boolean;
}> = [
  { id: "greeting", label: "Begrüssung", description: "Datum, Begrüssung und Uhrzeit", span: 12, top: true },
  // Die Apps von CareOS wie auf dem Startbildschirm eines Tablets (Kennung „shortcuts“ bleibt für gespeicherte Layouts).
  { id: "shortcuts", label: "Meine Apps", description: "Alle Apps auf einen Blick", span: 12, top: true },
  { id: "notes", label: "Meine Notizen", description: "Nur für dich sichtbar", span: 6, top: true },
  { id: "today", label: "Heute wichtig", description: "Offene Aufgaben auf einen Blick", span: 6, top: true },
  { id: "news", label: "Neuigkeiten", description: "Letzte Dokumentation je Bewohner", span: 12 },
  { id: "summary", label: "Schichtübersicht", description: "Kennzahlen für den aktuellen Dienst", span: 12 },
  { id: "worklist", label: "Tagesliste", description: "Was heute je Bewohner fällig ist", span: 12 },
  { id: "critical", label: "Wichtiger Hinweis", description: "Kritische Informationen", span: 12 },
  { id: "tasks", label: "Als Nächstes", description: "Offene Aufgaben", span: 7 },
  { id: "shift", label: "Zeitplan", description: "Deine nächsten terminierten Aufgaben", span: 5 },
  { id: "residents", label: "Meine Bewohner", description: "Zugewiesene Bewohner", span: 12 },
];

export const defaultDashboardOrder = dashboardWidgets.map((widget) => widget.id);
export const defaultDashboardTop = dashboardWidgets.filter((widget) => widget.top).map((widget) => widget.id);

export type DashboardLayoutState = {
  order: DashboardWidgetId[];
  hidden: DashboardWidgetId[];
  top: DashboardWidgetId[];
  sizes: Partial<Record<DashboardWidgetId, DashboardWidgetSize>>;
};

export const defaultDashboardLayout = (): DashboardLayoutState => ({
  order: defaultDashboardOrder,
  hidden: [],
  top: defaultDashboardTop,
  sizes: {},
});

// Beschriftung der Bereiche mit der Bezeichnung der Einrichtung (Bewohner / Patient / Klient).
export function widgetText(widget: (typeof dashboardWidgets)[number], terms: Terms) {
  if (widget.id === "worklist") return { label: widget.label, description: `Was heute je ${terms.one} fällig ist` };
  if (widget.id === "residents") return { label: `Meine ${terms.many}`, description: `Zugewiesene ${terms.many}` };
  if (widget.id === "news")
    return { label: `${terms.prefix}-Neuigkeiten`, description: `Letzte Dokumentation je ${terms.one}` };
  return { label: widget.label, description: widget.description };
}

export function widgetSpan(id: DashboardWidgetId, sizes: DashboardLayoutState["sizes"]) {
  const size = sizes[id];
  return DASHBOARD_SIZES.find((entry) => entry.id === size)?.span ?? dashboardWidgets.find((w) => w.id === id)!.span;
}

// Widgets missing in a saved layout (added later) are inserted at their default position.
export function completeDashboardOrder(order: DashboardWidgetId[]) {
  const result = [...order];
  defaultDashboardOrder.forEach((id, index) => {
    if (!result.includes(id)) result.splice(Math.min(index, result.length), 0, id);
  });
  return result;
}

// Gespeichertes Layout prüfen: unbekannte Bausteine und Breiten fallen weg; neue Bausteine kommen an ihren
// Standardplatz (auch in den Kopfbereich, wenn das Layout noch keine Angabe dazu hat).
export function sanitizeDashboardLayout(input: unknown): DashboardLayoutState {
  if (!input || typeof input !== "object") return defaultDashboardLayout();
  const stored = input as { order?: unknown; hidden?: unknown; top?: unknown; sizes?: unknown };
  const allowed = new Set<string>(defaultDashboardOrder);
  const ids = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((id): id is DashboardWidgetId => typeof id === "string" && allowed.has(id))
      : [];
  const storedOrder = ids(stored.order);
  const sizes: DashboardLayoutState["sizes"] = {};
  if (stored.sizes && typeof stored.sizes === "object")
    for (const [id, size] of Object.entries(stored.sizes as Record<string, unknown>))
      if (allowed.has(id) && DASHBOARD_SIZES.some((entry) => entry.id === size))
        sizes[id as DashboardWidgetId] = size as DashboardWidgetSize;
  const top = Array.isArray(stored.top)
    ? ids(stored.top)
    : // Ältere Layouts kennen keinen Kopfbereich: die bisher festen Bausteine stehen weiter dort.
      defaultDashboardTop;
  const known = new Set(storedOrder);
  return {
    order: completeDashboardOrder(storedOrder),
    hidden: ids(stored.hidden),
    top: [
      ...top,
      ...(Array.isArray(stored.top) ? defaultDashboardTop.filter((id) => !known.has(id) && !top.includes(id)) : []),
    ],
    sizes,
  };
}

export const dashboardLayoutStorageKey = "carecore.dashboard-layout.v1";

export function readStoredDashboardLayout(): DashboardLayoutState {
  if (typeof window === "undefined") return defaultDashboardLayout();
  try {
    const saved = window.localStorage.getItem(dashboardLayoutStorageKey);
    return saved ? sanitizeDashboardLayout(JSON.parse(saved)) : defaultDashboardLayout();
  } catch {
    return defaultDashboardLayout();
  }
}

export function Timeline({
  time,
  title,
  detail,
  state,
  variant = "",
  rail = false,
}: {
  time: string;
  title: string;
  detail: string;
  state: string;
  variant?: string;
  rail?: boolean;
}) {
  return (
    <div className={`timeline-row ${variant}`}>
      <time className="timeline-time">{time}</time>
      <span className="timeline-line">
        <i className="timeline-dot" />
        {rail && <i className="timeline-rail" />}
      </span>
      <span className="timeline-content">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className={`timeline-state ${variant === "done" ? "done" : variant === "current" ? "now" : ""}`}>
        {state}
      </span>
    </div>
  );
}
