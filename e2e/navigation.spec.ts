import { expect, test } from "@playwright/test";
import { navigation, routeFor } from "../app/components/navigation";
import { ADMIN, login, watchErrors, waitForNetworkIdle } from "./support";

test("Anmeldung über das Formular führt auf die Startseite", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.getByLabel("Benutzername").fill(ADMIN.username);
  await page.getByLabel("Passwort", { exact: true }).fill(ADMIN.password);
  await page.locator("button.login-submit").click();
  await expect(page).toHaveURL(/\/c(\/|$)/);
  await expect(page.locator("main").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Falsches Passwort wird abgelehnt", async ({ page }) => {
  const response = await page.request.post("/api/auth/login", { data: { username: "Admin", password: "falsch" } });
  expect(response.status()).toBe(401);
});

// Jede Seite der Navigation lädt ohne Skript- oder Serverfehler (Administration sieht alle Seiten).
const pages = navigation
  .flatMap((group) => group.modules)
  .flatMap((module) =>
    module.children.map((child) => ({ label: `${module.label} › ${child}`, url: routeFor(module.id, child) })),
  )
  .filter((entry): entry is { label: string; url: string } => entry.url !== null);

for (const entry of pages)
  test(`Seite lädt: ${entry.label}`, async ({ page }) => {
    await login(page, ADMIN);
    const errors = watchErrors(page);
    await page.goto(entry.url);
    await expect(page.locator("h1").first()).toBeVisible();
    await waitForNetworkIdle(page);
    expect(errors).toEqual([]);
  });

// Startseite: Tagesliste nach Kritisch / Wichtig / Routine gegliedert; Zahl im Filter = gezeigte Punkte.
test("Tagesliste gliedert nach Kritisch, Wichtig und Routine", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c");
  const filters = page.getByRole("group", { name: "Tagesliste filtern" });
  await expect(filters.getByRole("button", { name: /^Alle \d+$/ })).toBeVisible();
  const items = page.locator(".worklist-card .worklist-item");
  let sum = 0;
  for (const [label, tone] of [
    ["Kritisch", "critical"],
    ["Wichtig", "attention"],
    ["Routine", "info"],
  ] as const) {
    const button = filters.getByRole("button", { name: new RegExp(`^${label} \\d+$`) });
    const count = Number((await button.textContent())?.replace(/\D/g, ""));
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(items).toHaveCount(count);
    await expect(page.locator(`.worklist-card .worklist-item:not(.${tone})`)).toHaveCount(0);
    sum += count;
  }
  const all = filters.getByRole("button", { name: /^Alle \d+$/ });
  expect(Number((await all.textContent())?.replace(/\D/g, ""))).toBe(sum);
  await all.click();
  await expect(items).toHaveCount(sum);
  expect(errors).toEqual([]);
});

// Konfiguration: „Patient“ statt „Bewohner“ gilt in Navigation, Kopfzeile und Startseite.
test("Bezeichnung der betreuten Personen umstellen: Patient", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  try {
    await page.goto("/c/leitung/administration/konfiguration");
    const options = page.getByRole("group", { name: "Bezeichnung wählen" });
    await expect(options.getByRole("button", { name: "Bewohner" })).toHaveAttribute("aria-pressed", "true");
    await options.getByRole("button", { name: "Patient" }).click();
    await expect(page.locator(".toast")).toContainText("Bezeichnung „Patient“ gespeichert");
    await expect(options.getByRole("button", { name: "Patient" })).toHaveAttribute("aria-pressed", "true");

    await page.goto("/c");
    await expect(page.locator(".summary-label").first()).toHaveText("Patienten zugeteilt");
    await expect(page.locator(".resident-context-copy small").first()).toHaveText("Patient");
    await page.goto("/c/bewohner");
    await expect(page.getByRole("heading", { level: 1, name: "Patienten" })).toBeVisible();
    await expect(page).toHaveTitle("CareOS · Patienten");
    await expect(page.getByRole("button", { name: "Patienten aufnehmen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Patientenverzeichnis" })).toBeVisible();
    await page.goto("/c/leitung/kennzahlen/bewohner");
    await expect(page.locator(".page-tabs").getByRole("link", { name: "Kennzahlen Patienten" })).toBeVisible();
  } finally {
    expect((await page.request.patch("/api/settings/terminology", { data: { value: "resident" } })).status()).toBe(200);
  }
  expect(errors).toEqual([]);
});

// CareOS: die Leiste zeigt jede App mit Symbol und Namen; „Alle Apps“ öffnet alle Apps mit kurzer Beschreibung.
// CareOS Kompass ist ein eigener Bereich gleich nach Bewohner & Pflege, mit eigenem Logo.
test("CareOS: Leiste mit Namen, „Alle Apps“ mit Suche, Kompass nach Bewohner & Pflege", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c");
  const dock = page.getByRole("complementary", { name: "Hauptnavigation" });
  // Jeder Knopf der Leiste hat einen sichtbaren Namen, nicht nur ein Symbol.
  for (const name of ["Start", "Mein Dienst", "Bewohner", "Doku", "Medikamente", "Alle Apps"])
    await expect(dock.locator(".careos-dock-label", { hasText: new RegExp(`^${name}$`) })).toBeVisible();

  await dock.getByRole("button", { name: "Alle Apps" }).click();
  const launcher = page.getByRole("dialog", { name: "Alle Apps" });
  await expect(launcher).toBeVisible();
  const groups = await launcher
    .locator(".careos-app-group > h3")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect(groups[groups.indexOf("Bewohner & Pflege") + 1]).toBe("CareOS Kompass");
  const kompass = launcher.getByRole("button", { name: "Kompass", exact: true });
  await expect(kompass.locator(".sidebar-kompass-icon")).toBeVisible();
  await expect(kompass).toContainText("Pflegebedarf abklären");

  // Suche: nur passende Apps, auch über die Seiten einer App.
  await launcher.getByRole("searchbox", { name: "App suchen" }).fill("btm");
  await expect(launcher.locator(".careos-app-tile")).toHaveCount(1);
  await expect(launcher.getByRole("button", { name: /^Medikamente/ })).toBeVisible();
  await launcher.getByRole("searchbox", { name: "App suchen" }).fill("");

  await kompass.click();
  await expect(page).toHaveURL(/\/c\/kompass$/);
  await expect(launcher).toHaveCount(0);
  // Kopf der App: Symbol und Name, „Alle Apps“ ist in der Leiste markiert (Kompass steht nicht in der Leiste).
  await expect(page.locator(".careos-app-bar-name")).toHaveText("Kompass");
  await expect(dock.getByRole("button", { name: "Alle Apps" })).toHaveClass(/active/);

  // Taste L öffnet „Alle Apps“, Escape schliesst.
  await page.locator("body").click({ position: { x: 600, y: 600 } });
  await page.keyboard.press("l");
  await expect(launcher).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(launcher).toHaveCount(0);
  expect(errors).toEqual([]);
});
