// Benachrichtigungsklassen (PRD): Kritisch, Handlung nötig, Information, Sozial – dazu die Bündelung
// gleichartiger Hinweise im Posteingang. Gemeinsam für Server und Browser.

export const NOTIFICATION_CLASSES = {
  critical: { label: "Kritisch", tone: "critical", icon: "alert" },
  action: { label: "Handlung nötig", tone: "attention", icon: "tasks" },
  info: { label: "Information", tone: "info", icon: "bell" },
  social: { label: "Sozial", tone: "stable", icon: "team" },
} as const;
export type NotificationClass = keyof typeof NOTIFICATION_CLASSES;

// Hinweise, die eine Person selbst erledigen oder entscheiden muss.
const ACTION_TYPES = [
  "task_assigned",
  "task_due",
  "task_escalated",
  "btm_count_due",
  "device_check_due",
  "fridge_reading_due",
  "fridge_temperature_outside",
  "onboarding_mentor",
  "feedback_assigned",
  "feedback_overdue",
  "wound_overdue",
  "medication_effect_check",
  "visit_answered",
  "rai_due",
  "supply_low",
  "support_request",
  "message_mention",
  "learning",
  "quality_action",
  "shift_time_off_requested",
  "shift_preference_submitted",
  "shift_swap_requested",
  "shift_swap_approval_needed",
  "shift_clock_out_missing",
  "shift_time_deviation",
  "shift_time_correction_requested",
  "shift_staffing_problem",
  "shift_unplanned_work",
  "shift_open_shift_interest",
];
// Austausch im Team ohne Handlungsbedarf.
const SOCIAL_TYPES = ["message_direct", "team_post"];

export function notificationClass(type: string, priority: string): NotificationClass {
  if (priority === "critical") return "critical";
  if (ACTION_TYPES.some((prefix) => type === prefix || type.startsWith(`${prefix}_`))) return "action";
  if (SOCIAL_TYPES.includes(type)) return "social";
  return priority === "high" ? "action" : "info";
}

type Bundleable = { id: string; type: string; priority: string; title: string; created_at: string };

export type NotificationEntry<T extends Bundleable> =
  { kind: "single"; item: T } | { kind: "bundle"; key: string; type: string; label: string; items: T[] };

// Ab so vielen Hinweisen desselben Typs am selben Tag werden sie zu einer Zeile gebündelt.
export const BUNDLE_MIN = 3;

// Gemeinsamer Titelanfang („Aufgabe fällig: …“) als Bezeichnung des Bündels.
function bundleLabel(items: Bundleable[]) {
  const prefixes = new Set(items.map((item) => item.title.split(":")[0].trim()));
  return prefixes.size === 1 && items[0].title.includes(":") ? [...prefixes][0] : "Gleichartige Hinweise";
}

// Kritische Hinweise werden nie gebündelt; die Reihenfolge (neueste zuerst) bleibt erhalten, ein Bündel steht
// an der Stelle seines neuesten Hinweises.
export function bundleNotifications<T extends Bundleable>(items: T[], day: (value: string) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (notificationClass(item.type, item.priority) === "critical") continue;
    const key = `${item.type}|${day(item.created_at)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const entries: NotificationEntry<T>[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const key = `${item.type}|${day(item.created_at)}`;
    const group = notificationClass(item.type, item.priority) === "critical" ? undefined : groups.get(key);
    if (!group || group.length < BUNDLE_MIN) {
      entries.push({ kind: "single", item });
      continue;
    }
    if (placed.has(key)) continue;
    placed.add(key);
    entries.push({ kind: "bundle", key, type: item.type, label: bundleLabel(group), items: group });
  }
  return entries;
}
