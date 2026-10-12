import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSettings } from "../lib/settings-shared.ts";
import { notifyCategory, resolvePreferences, START_PAGES } from "../lib/user-settings-shared.ts";

test("organisation settings fall back to safe defaults", () => {
  const settings = resolveSettings({ documentationReminder: { enabled: false, value: 999 }, keyboardShortcuts: "x" });
  assert.equal(settings.documentationReminder.enabled, false);
  assert.equal(settings.documentationReminder.value, 24, "out of range falls back to the default");
  assert.equal(settings.keyboardShortcuts.enabled, true);
  assert.equal(settings.navigationBadges.value, null);
  // Das BtM-Kontrollintervall hat keinen Standardwert; die Einrichtung legt es fest.
  assert.deepEqual(settings.btmCountInterval, { enabled: false, value: null });
  assert.deepEqual(resolveSettings({ btmCountInterval: { enabled: true, value: 14 } }).btmCountInterval, {
    enabled: true,
    value: 14,
  });
});

test("personal preferences default to everything on", () => {
  const preferences = resolvePreferences(null);
  assert.ok(Object.values(preferences.notify).every(Boolean));
  assert.equal(preferences.textSize, "standard");
  assert.equal(preferences.startPage, "home");
  const custom = resolvePreferences({ notify: { supply: false }, startPage: "med", textSize: "huge" });
  assert.equal(custom.notify.supply, false);
  assert.equal(custom.notify.tasks, true);
  assert.equal(custom.textSize, "standard");
  assert.ok(START_PAGES[custom.startPage].path.startsWith("/c"));
});

test("notification types map to their category", () => {
  assert.equal(notifyCategory("task_due"), "tasks");
  assert.equal(notifyCategory("shift_reminder"), "schedule");
  assert.equal(notifyCategory("supply_low"), "supply");
  assert.equal(notifyCategory("btm_count_due"), "btm");
  assert.equal(notifyCategory("support_request"), null);
});

test("new personal preferences: defaults, invalid values and quiet hours across midnight", async () => {
  const { inQuietHours, TEXT_SIZES, AUTO_LOGOUT_MINUTES } = await import("../lib/user-settings-shared.ts");
  const defaults = resolvePreferences(undefined);
  assert.equal(defaults.motion, "standard");
  assert.equal(defaults.shortcuts, true);
  assert.equal(defaults.sound, false);
  assert.equal(defaults.dictation, false, "Spracheingabe aus, bis die Person sie einschaltet");
  assert.equal(resolvePreferences({ dictation: true }).dictation, true);
  assert.equal(resolvePreferences({ dictation: "ja" }).dictation, false);
  assert.equal(defaults.autoLogout, 0);
  assert.deepEqual(defaults.quietHours, { enabled: false, from: "22:00", to: "06:00", critical: true });
  const custom = resolvePreferences({
    textSize: "xlarge",
    motion: "reduced",
    shortcuts: false,
    sound: true,
    autoLogout: 30,
    quietHours: { enabled: true, from: "21:30", to: "07:00" },
  });
  assert.equal(TEXT_SIZES[custom.textSize], "Sehr gross");
  assert.equal(custom.motion, "reduced");
  assert.equal(custom.shortcuts, false);
  assert.equal(custom.sound, true);
  assert.ok((AUTO_LOGOUT_MINUTES as readonly number[]).includes(custom.autoLogout));
  const broken = resolvePreferences({ autoLogout: 7, quietHours: { enabled: true, from: "25:00", to: "25:00" } });
  assert.equal(broken.autoLogout, 0);
  assert.deepEqual(broken.quietHours, { enabled: false, from: "22:00", to: "06:00", critical: true });

  const night = { enabled: true, from: "22:00", to: "06:00" };
  assert.equal(inQuietHours(night, "23:15"), true);
  assert.equal(inQuietHours(night, "05:59"), true);
  assert.equal(inQuietHours(night, "06:00"), false);
  assert.equal(inQuietHours(night, "12:00"), false);
  const day = { enabled: true, from: "12:00", to: "13:30" };
  assert.equal(inQuietHours(day, "12:45"), true);
  assert.equal(inQuietHours(day, "13:30"), false);
  assert.equal(inQuietHours({ ...night, enabled: false }, "23:15"), false);
});

test("Meine Kennzahlen: nur gültige, eindeutige Kennzahlen, höchstens 16", async () => {
  const { INSIGHT_PINS_MAX, insightPin } = await import("../lib/user-settings-shared.ts");
  assert.deepEqual(resolvePreferences(null).insightPins, []);
  const pins = resolvePreferences({
    insightPins: [insightPin("care", "Dokumentation"), "care:Dokumentation", "unbekannt:X", 5, "residents:"],
  }).insightPins;
  assert.deepEqual(pins, ["care:Dokumentation"]);
  const many = Array.from({ length: 20 }, (_, index) => insightPin("leadership", `Kennzahl ${index}`));
  assert.equal(resolvePreferences({ insightPins: many }).insightPins.length, INSIGHT_PINS_MAX);
});
