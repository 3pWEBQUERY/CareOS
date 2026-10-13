import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Der Arbeitsplatz wirkt wie eine einzige Anwendung: Menüleiste und Dock bleiben beim Seitenwechsel dieselben
// Elemente (kein Neuaufbau, kein Neuladen), nur der Inhalt wechselt. Druckansichten stehen ohne Rahmen.

test("Rahmen bleibt beim Wechsel zwischen Reitern, Bereichen und Startseite stehen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/pflegeplanung");
  await expect(page.getByRole("heading", { name: "Pflegeplanung", level: 1 })).toBeVisible();
  // Merker an Dock, Menüleiste und Fenster: Sie überleben nur, wenn nichts neu aufgebaut oder geladen wird.
  await page.evaluate(() => {
    const marks = window as unknown as Record<string, unknown>;
    marks.frameDock = document.querySelector(".careos-dock");
    marks.frameHeader = document.querySelector(".topbar");
    marks.frameAlive = true;
  });
  const sameFrame = () =>
    page.evaluate(() => {
      const marks = window as unknown as Record<string, unknown>;
      return (
        marks.frameAlive === true &&
        marks.frameDock === document.querySelector(".careos-dock") &&
        marks.frameHeader === document.querySelector(".topbar")
      );
    });

  // Reiter im selben Bereich.
  await page
    .getByRole("navigation", { name: /Seiten$/ })
    .getByRole("link", { name: "Ziele & Massnahmen" })
    .click();
  await expect(page).toHaveURL(/\/c\/pflegeplanung\/ziele-massnahmen$/);
  await expect(page.getByRole("heading", { name: "Ziele & Massnahmen", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: /Seiten$/ }).getByRole("link", { name: "Ziele & Massnahmen" }),
  ).toHaveAttribute("aria-current", "page");
  expect(await sameFrame()).toBe(true);

  // Startseite über das Dock und weiter in einen anderen Bereich.
  const dock = page.getByRole("navigation", { name: "Dock" });
  await dock.getByRole("link", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/c$/);
  expect(await sameFrame()).toBe(true);
  await dock.getByRole("link", { name: "Einstellungen", exact: true }).click();
  await expect(page).toHaveURL(/\/c\/einstellungen/);
  expect(await sameFrame()).toBe(true);

  // Zurück im Verlauf: ebenfalls ohne Neuladen.
  await page.goBack();
  await expect(page).toHaveURL(/\/c$/);
  expect(await sameFrame()).toBe(true);
  expect(errors).toEqual([]);
});

test("Handy: untere Menüleiste bleibt beim Seitenwechsel stehen und wird nicht überblendet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, ADMIN);
  await page.goto("/c/pflegeplanung");
  const bar = page.getByRole("navigation", { name: "Mobile Navigation" });
  await expect(bar).toBeVisible();
  await bar.evaluate((element) => ((window as unknown as Record<string, unknown>).frameBar = element));
  // Eigenständig erfasst: Der wechselnde Inhalt überdeckt die Leiste während des Übergangs nicht.
  expect(await bar.evaluate((element) => getComputedStyle(element).viewTransitionName)).toBe("app-bottom-nav");
  await page
    .getByRole("navigation", { name: /Seiten$/ })
    .getByRole("link", { name: "Ziele & Massnahmen" })
    .click();
  await expect(page).toHaveURL(/ziele-massnahmen$/);
  await bar.getByRole("button", { name: /Bewohner/ }).click();
  await expect(page).toHaveURL(/\/c\/bewohner$/);
  expect(await bar.evaluate((element) => (window as unknown as Record<string, unknown>).frameBar === element)).toBe(
    true,
  );
});

test("Druckansicht steht ohne Rahmen", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/c/ernaehrung/kuechenliste");
  await expect(page.locator(".careos-dock")).toHaveCount(0);
  await expect(page.locator(".topbar")).toHaveCount(0);
});
