import { test } from "node:test";
import assert from "node:assert/strict";
import { BUNDLE_MIN, bundleNotifications, notificationClass } from "@/lib/notification-classes";

test("Benachrichtigungsklassen: kritisch vor Typ, Handlung, Sozial und Information", () => {
  assert.equal(notificationClass("task_due", "critical"), "critical");
  assert.equal(notificationClass("quality_event", "critical"), "critical");
  assert.equal(notificationClass("task_due", "normal"), "action");
  assert.equal(notificationClass("medication_effect_check", "high"), "action");
  assert.equal(notificationClass("shift_swap_requested", "normal"), "action");
  assert.equal(notificationClass("message_mention", "high"), "action");
  assert.equal(notificationClass("message_direct", "normal"), "social");
  assert.equal(notificationClass("team_post", "high"), "social");
  assert.equal(notificationClass("shift_schedule_published", "normal"), "info");
  assert.equal(notificationClass("quality_event", "high"), "action");
});

const at = (hour: number, day = 29) => `2026-09-${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const item = (id: string, type: string, title: string, created: string, priority = "normal") => ({
  id,
  type,
  title,
  priority,
  created_at: created,
});
const dayOf = (value: string) => value.slice(0, 10);

test("Bündelung: ab drei gleichen Hinweisen am selben Tag, kritische nie, Reihenfolge bleibt", () => {
  assert.equal(BUNDLE_MIN, 3);
  const items = [
    item("1", "task_due", "Aufgabe fällig: Lagerung", at(12)),
    item("2", "message_direct", "Nachricht von Anna", at(11)),
    item("3", "task_due", "Aufgabe fällig: Mobilisation", at(10)),
    item("4", "task_due", "Aufgabe fällig: Verband", at(9)),
    item("5", "task_due", "Aufgabe fällig: Sturz", at(8), "critical"),
    item("6", "task_due", "Aufgabe fällig: Gestern", at(9, 28)),
  ];
  const entries = bundleNotifications(items, dayOf);
  assert.deepEqual(
    entries.map((entry) =>
      entry.kind === "single" ? entry.item.id : `bundle:${entry.items.map((i) => i.id).join(",")}`,
    ),
    ["bundle:1,3,4", "2", "5", "6"],
  );
  const [bundle] = entries;
  assert.equal(bundle.kind === "bundle" && bundle.label, "Aufgabe fällig");

  // Zwei gleiche Hinweise bleiben einzeln.
  assert.deepEqual(
    bundleNotifications(items.slice(0, 3), dayOf).map((entry) => entry.kind),
    ["single", "single", "single"],
  );
});
