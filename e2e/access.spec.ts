import { expect, test } from "@playwright/test";
import { ADMIN, FAGE, login, watchErrors } from "./support";

// Seiten, die die Navigation einer Rolle nicht zeigt, öffnen auch per Adresse nicht: „Kein Zugriff“ statt einer
// halb geladenen Seite mit Fehlermeldungen; Seiten mit Recht öffnen normal.
test("Direkter Aufruf ohne Recht zeigt „Kein Zugriff“, mit Recht die Seite", async ({ page }) => {
  await login(page, FAGE);
  const errors = watchErrors(page);
  for (const path of [
    "/c/leitung/administration/konfiguration",
    "/c/kompass",
    "/c/dienstplan/einstellungen",
    "/c/leitung/kennzahlen",
    "/c/intelligenz",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toBeVisible();
  }
  await page.getByRole("link", { name: "Zur Startseite" }).click();
  await expect(page).toHaveURL(/\/c$/);
  await page.goto("/c/medikation");
  await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Administration öffnet die Seiten der Leitung", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/c/leitung/administration/konfiguration");
  await expect(page.getByRole("heading", { level: 1, name: "Konfiguration" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kein Zugriff" })).toHaveCount(0);
});
