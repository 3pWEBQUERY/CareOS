import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Fahrdienst: Termin ausser Haus im Kalender erfassen, Tagesliste, Abfahrt und Rückkehr vermerken, Druckansicht.
test("Fahrdienst: Termin ausser Haus, Tagesliste, Abfahrt, Rückkehr, Druck", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const title = `Zahnarzt ${Date.now().toString().slice(-5)}`;
  await page.goto("/c/carecore-one/kalender");
  await page.getByRole("button", { name: "Termin erstellen" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Termin erstellen" });
  await dialog.getByLabel("Bezeichnung").fill(title);
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  await dialog.getByRole("button", { name: "Termin ausser Haus (Fahrdienst)" }).click();
  await dialog.getByRole("combobox", { name: "Transport" }).click();
  await page.getByRole("option", { name: "Taxi / Fahrdienst" }).click();
  await dialog.getByLabel("Begleitung").fill("Tochter");
  await dialog.getByLabel("Mitzugebende Unterlagen").fill("Überleitungsbogen, Versichertenkarte");
  await dialog.getByRole("button", { name: "Termin erstellen" }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto("/c/carecore-one/kalender/fahrdienst");
  await expect(page.getByRole("heading", { name: "Fahrdienst", level: 1 })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("Taxi / Fahrdienst · Begleitung: Tochter");
  await expect(row).toContainText("Mitgeben: Überleitungsbogen, Versichertenkarte");
  await expect(row).toContainText("Noch im Haus");
  await row.getByRole("button", { name: /abgefahren$/ }).click();
  await expect(row).toContainText("Unterwegs seit");
  await row.getByRole("button", { name: /zurück$/ }).click();
  await expect(row).toContainText(/Zurück \d{2}:\d{2}/);

  await page.goto("/c/carecore-one/kalender/fahrdienst/druck?dialog=0");
  await expect(page.getByRole("heading", { name: /Tagesliste Fahrdienst · / })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: title })).toContainText("Taxi / Fahrdienst");
  expect(errors).toEqual([]);
});
