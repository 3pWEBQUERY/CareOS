import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Qualitätsindikatoren: sechs MQI mit Anteil, Grundlage und Export als CSV.
test("Qualitätsindikatoren: sechs MQI, Wohnbereich wählen, CSV exportieren", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/leitung/kennzahlen/qualitaetsindikatoren");
  await expect(page.getByRole("heading", { name: "Qualitätsindikatoren", level: 1 })).toBeVisible();
  const cards = page.locator(".quality-indicator-card");
  await expect(cards).toHaveCount(6);
  for (const title of [
    "Mangelernährung",
    "Rumpffixation / Sitzgelegenheit",
    "Bettgitter",
    "Polymedikation",
    "Schmerz (Selbsteinschätzung)",
    "Dekubitus",
  ])
    await expect(page.getByRole("region", { name: title })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dekubitus" })).toContainText("Nach Definition");
  await expect(page.getByRole("region", { name: "Polymedikation" })).toContainText("Annäherung");

  await page.getByRole("combobox", { name: "Wohnbereich" }).click();
  await page.getByRole("option").nth(1).click();
  await expect(page.locator(".quality-indicators-meta")).not.toContainText("Alle Wohnbereiche");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV exportieren" }).click();
  expect((await download).suggestedFilename()).toMatch(/^qualitaetsindikatoren-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(errors).toEqual([]);
});
