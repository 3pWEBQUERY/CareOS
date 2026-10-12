import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Lagerung & Bewegung: Plan mit Intervall aus der Pflegeplanung, Positionswechsel mit Hautbefund erfassen,
// stornieren und den Plan beenden.
test("Lagerung: Plan festlegen, Positionswechsel erfassen und stornieren, Plan beenden", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  await page.goto("/c/pflegedokumentation/lagerung");
  await expect(page.getByRole("heading", { name: "Lagerung & Bewegung", level: 1 })).toBeVisible();
  const planCard = page.getByRole("region", { name: "Lagerungsplan", exact: true });
  // Ausgangslage: kein laufender Plan (auch nach einem abgebrochenen Lauf); erst nach dem Laden prüfen.
  await expect(planCard.getByRole("button", { name: /^Plan (festlegen|ändern)$/ })).toBeVisible();
  if (await planCard.getByRole("button", { name: "Plan beenden" }).isVisible()) {
    await planCard.getByRole("button", { name: "Plan beenden" }).click();
    const end = page.getByRole("dialog", { name: "Lagerungsplan beenden" });
    await end.getByLabel("Grund").fill("Ausgangslage Klicktest");
    await end.getByRole("button", { name: "Plan beenden" }).click();
  }
  await expect(planCard).toContainText("Noch kein Plan festgelegt");

  await planCard.getByRole("button", { name: "Plan festlegen" }).click();
  const planDialog = page.getByRole("dialog", { name: "Lagerungsplan festlegen" });
  await planDialog.getByLabel("Intervall: Stunden").fill("3");
  await planDialog.getByLabel("Hinweise (optional)").fill("Keil links");
  await planDialog.getByRole("button", { name: "Speichern" }).click();
  await expect(planCard).toContainText("alle 3 Std.");
  await expect(planCard).toContainText("Keil links");

  const note = `Klicktest ${Date.now()}`;
  await page.getByRole("button", { name: "Positionswechsel erfassen" }).click();
  const entry = page.getByRole("dialog", { name: "Positionswechsel erfassen" });
  await entry.getByRole("button", { name: "Speichern" }).click();
  await expect(entry.getByRole("alert")).toContainText("Bitte die Position wählen.");
  await entry.getByRole("group", { name: "Position" }).getByRole("button", { name: "30°-Seitenlage links" }).click();
  await entry
    .getByRole("group", { name: "Hautbefund" })
    .getByRole("button", { name: "Haut verletzt oder offen" })
    .click();
  await expect(entry.getByRole("link", { name: "Wundmanagement" })).toBeVisible();
  await entry.getByRole("group", { name: "Hautbefund" }).getByRole("button", { name: "Rötung, wegdrückbar" }).click();
  await entry.getByLabel("Bemerkung (optional)").fill(note);
  await entry.getByRole("button", { name: "Speichern" }).click();
  const history = page.getByRole("region", { name: "Verlauf der Positionswechsel" });
  const item = history.locator("li", { hasText: note });
  await expect(item).toContainText("30°-Seitenlage links");
  await expect(item).toContainText("Rötung, wegdrückbar");
  await expect(page.getByRole("region", { name: "Lagerung", exact: true })).toContainText("nächster Wechsel");

  await item.getByRole("button", { name: "Stornieren" }).click();
  const cancel = page.getByRole("dialog", { name: "Positionswechsel stornieren" });
  await cancel.getByLabel("Grund der Stornierung").fill("doppelt erfasst");
  await cancel.getByRole("button", { name: "Stornieren" }).click();
  await expect(item).toContainText("Storniert: doppelt erfasst");

  await planCard.getByRole("button", { name: "Plan beenden" }).click();
  const end = page.getByRole("dialog", { name: "Lagerungsplan beenden" });
  await end.getByLabel("Grund").fill("wieder selbständig mobil");
  await end.getByRole("button", { name: "Plan beenden" }).click();
  await expect(planCard).toContainText("Noch kein Plan festgelegt");
  expect(errors).toEqual([]);
});
