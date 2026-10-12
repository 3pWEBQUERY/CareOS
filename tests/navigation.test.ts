import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCK_APPS,
  MOBILE_DOCK_APPS,
  activePage,
  appHref,
  navigation,
  navigationFor,
  routeFor,
  sidebarNavigation,
} from "../app/components/navigation.ts";

const modules = navigation.flatMap((group) => group.modules);

test("every tab of the sidebar has a route", () => {
  for (const entry of modules)
    for (const child of entry.children) assert.ok(routeFor(entry.id, child), `${entry.id} · ${child}`);
});

test("no two tabs share an address", () => {
  const seen = new Map<string, string>();
  for (const entry of modules)
    for (const child of entry.children) {
      const route = routeFor(entry.id, child)!;
      assert.equal(seen.get(route), undefined, `${route} used twice`);
      seen.set(route, `${entry.id} · ${child}`);
    }
});

test("the address decides module and tab", () => {
  assert.deepEqual(activePage("/c/medikation/runde"), { moduleId: "med", child: "Medikamentenrunde" });
  assert.deepEqual(activePage("/c/ernaehrung/trinkprotokoll"), { moduleId: "nutrition", child: "Trinkprotokoll" });
  assert.deepEqual(activePage("/c/betrieb/uebergabe/letzter-dienst"), {
    moduleId: "shift",
    child: "Seit letztem Dienst",
  });
  // Detail pages below a tab keep the tab active; without /c prefix too.
  assert.deepEqual(activePage("/bewohner/verlauf/123"), { moduleId: "residents", child: "Verlauf & Archiv" });
  assert.equal(activePage("/c"), null);
  assert.equal(activePage("/c/unbekannt"), null);
});

test("modules and tabs follow the permissions", () => {
  const care = navigationFor(["residents.read", "residents.write", "documentation.write", "medication.manage"]);
  const ids = care.flatMap((group) => group.modules.map((module) => module.id));
  assert.ok(ids.includes("med"));
  assert.ok(!ids.includes("admin"));
  assert.ok(!ids.includes("rai"));
  assert.ok(!ids.includes("staff"), "no tab of Mitarbeitende & Dienste without team or admin rights");
  const quality = care.flatMap((group) => group.modules).find((module) => module.id === "quality");
  assert.deepEqual(quality?.children, ["Ereignisse"]);

  const admin = navigationFor(["administration.manage"]);
  const staff = admin.flatMap((group) => group.modules).find((module) => module.id === "staff");
  assert.deepEqual(staff?.children, ["Profile & Rollen"]);
});

test("CareOS KI is reached from the header, not the sidebar", () => {
  const ids = sidebarNavigation(["ai.use"]).flatMap((group) => group.modules.map((module) => module.id));
  assert.ok(!ids.includes("ai"));
  assert.deepEqual(activePage("/c/intelligenz/entwuerfe"), { moduleId: "ai", child: "KI-Entwürfe" });
});

test("Kommunikation bundles messages, calendar and files", () => {
  const group = sidebarNavigation([]).find((entry) => entry.id === "carecore-one");
  assert.equal(group?.label, "Kommunikation");
  assert.deepEqual(
    group?.modules.map((entry) => entry.id),
    ["messenger", "one-calendar", "cloud"],
  );
  assert.deepEqual(activePage("/c/carecore-one/kalender"), { moduleId: "one-calendar", child: "Kalender" });
  assert.deepEqual(activePage("/c/carecore-one/messenger"), { moduleId: "messenger", child: "Nachrichten" });
  assert.deepEqual(activePage("/c/carecore-one/ablage"), { moduleId: "cloud", child: "Gemeinsame Ablage" });
  assert.deepEqual(activePage("/c/carecore-one/cloud"), { moduleId: "cloud", child: "Meine Dateien" });
});

test("CareOS Kompass is its own main area right after Bewohner & Pflege", () => {
  const groups = sidebarNavigation(["rai.manage"]);
  const ids = groups.map((group) => group.id);
  assert.equal(ids[ids.indexOf("clinical") + 1], "kompass");
  const kompass = groups.find((group) => group.id === "kompass");
  assert.equal(kompass?.label, "CareOS Kompass");
  assert.deepEqual(
    kompass?.modules.map((entry) => entry.id),
    ["rai"],
  );
  assert.ok(!groups.find((group) => group.id === "clinical")?.modules.some((entry) => entry.id === "rai"));
  assert.ok(!sidebarNavigation([]).some((group) => group.id === "kompass"));
  assert.deepEqual(activePage("/c/kompass/abklaerung"), { moduleId: "rai", child: "Abklärung" });
});

test("CareOS: every app has a colour, a plain-language hint and an icon of its own", () => {
  const apps = modules.filter((entry) => !entry.hiddenInSidebar);
  for (const app of apps) {
    assert.ok(app.hue >= 0 && app.hue <= 360, `${app.id} hue`);
    assert.ok(app.hint.length > 10 && app.hint.length <= 70, `${app.id} hint`);
  }
  // Mein Dienst und Vitalwerte trugen früher dasselbe Herz-Symbol.
  const shift = modules.find((entry) => entry.id === "shift");
  const vitals = modules.find((entry) => entry.id === "vitals");
  assert.notEqual(shift?.icon, vitals?.icon);
});

test("CareOS: the dock shows the same apps for everyone who may use them", () => {
  const ids = sidebarNavigation([]).flatMap((group) => group.modules.map((module) => module.id));
  for (const id of DOCK_APPS) assert.ok(ids.includes(id), `${id} reachable for all staff`);
  for (const id of MOBILE_DOCK_APPS) assert.ok(DOCK_APPS.includes(id), `${id} also in the desktop dock`);
  const chart = modules.find((entry) => entry.id === "chart")!;
  assert.equal(appHref(chart), "/c/pflegedokumentation");
});
