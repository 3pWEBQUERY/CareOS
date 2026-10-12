import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Wäsche- und Inventarliste: Kleidung mit Anzahl erfassen, Inventarliste mit Unterschriftsfeldern drucken.
test("Inventarliste: Kleidung mit Anzahl erfassen und Inventarliste öffnen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const marking = `Namensetikett ${Date.now().toString().slice(-5)}`;
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").nth(5).click();
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  const card = page.getByRole("region", { name: "Hilfsmittel & Gegenstände" });
  await card.getByRole("button", { name: "Hilfsmittel oder Gegenstand erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Hilfsmittel oder Gegenstand erfassen" });
  await dialog.getByRole("button", { name: "Kleidung / Wäsche" }).click();
  await dialog.getByRole("button", { name: "Socken" }).click();
  await dialog.getByLabel("Anzahl").fill("6");
  await dialog.getByLabel("Kennzeichnung").fill(marking);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  const item = card.locator("li", { hasText: marking });
  await expect(item).toContainText("6 × Socken");
  await expect(item).toContainText("Wäsche");

  const href = await card.getByRole("link", { name: "Inventarliste drucken" }).getAttribute("href");
  await page.goto(`${href}&dialog=0`);
  await expect(page.getByRole("heading", { name: /^Wäsche- und Inventarliste · / })).toBeVisible();
  const clothing = page.getByRole("region", { name: "Kleidung / Wäsche" });
  await expect(clothing.getByRole("row", { name: new RegExp(marking) })).toContainText("6");
  await expect(page.locator(".inventory-signatures")).toContainText("Person bzw. Vertretung");
  expect(errors).toEqual([]);
});
