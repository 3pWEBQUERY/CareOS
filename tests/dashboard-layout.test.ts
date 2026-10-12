import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDashboardLayout } from "@/lib/dashboard-layout";
import { normalizePageLayout, pageLayoutKey } from "@/lib/page-layouts";

// Gespeichertes Arbeitsplatz-Layout: alte Layouts (nur Reihenfolge/ausgeblendet) bleiben gültig; Kopfbereich und
// Breiten werden geprüft, ungültige Angaben abgelehnt.
test("Arbeitsplatz-Layout: alte und neue Form, Prüfung von Kopfbereich und Breiten", () => {
  assert.deepEqual(normalizeDashboardLayout({ order: ["summary", "summary", "tasks"], hidden: [] }), {
    order: ["summary", "tasks"],
    hidden: [],
  });
  assert.deepEqual(
    normalizeDashboardLayout({
      order: ["notes", "news"],
      hidden: ["shortcuts"],
      top: ["today", "news"],
      sizes: { notes: "half", news: "full" },
    }),
    { order: ["notes", "news"], hidden: ["shortcuts"], top: ["today", "news"], sizes: { notes: "half", news: "full" } },
  );
  assert.equal(normalizeDashboardLayout({ order: [], hidden: [], sizes: { notes: "riesig" } }), null);
  assert.equal(normalizeDashboardLayout({ order: [], hidden: [], sizes: ["half"] }), null);
  assert.equal(normalizeDashboardLayout({ order: [], hidden: [], top: "notes" }), null);
  assert.equal(normalizeDashboardLayout({ order: Array.from({ length: 51 }, (_, i) => `w${i}`), hidden: [] }), null);
  assert.equal(normalizeDashboardLayout({ hidden: [] }), null);
});

test("Seiten-Layout (Kennzahlen): nur bekannte Seiten, geprüfte Bausteine, Breiten und Stapelung", () => {
  assert.equal(pageLayoutKey("insights-care"), "insights-care");
  assert.equal(pageLayoutKey("admin-users"), null);
  assert.deepEqual(
    normalizePageLayout({ order: ["kpis", "staffing"], hidden: [], sizes: { staffing: "full" }, stacked: [] }),
    { order: ["kpis", "staffing"], hidden: [], sizes: { staffing: "full" }, stacked: [] },
  );
  assert.deepEqual(normalizePageLayout({ order: ["kpis"] }), { order: ["kpis"], hidden: [], sizes: {} });
  assert.equal(normalizePageLayout({ order: ["<script>"], hidden: [] }), null);
  assert.equal(normalizePageLayout({ order: [], sizes: { kpis: "gross" } }), null);
  assert.equal(normalizePageLayout({ order: [], stacked: "trainings" }), null);
  assert.equal(normalizePageLayout([]), null);
});
