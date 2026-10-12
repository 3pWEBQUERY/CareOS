import { expect, test } from "@playwright/test";
import { ADMIN, login, pickDate, watchErrors } from "./support";

// Vorsorge und Vertretung: Patientenverfügung in den Stammdaten, vertretungsberechtigte Kontaktperson, beides im
// Aktenkopf und im FBM-Formular vorbelegt.
test("Vorsorge: Patientenverfügung und Vertretung erscheinen im Aktenkopf", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").nth(4).click();
  const header = page.locator(".record-header-actions");
  await expect(header.locator(".record-advance-care")).toHaveText("PV: –");

  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  await page.getByRole("button", { name: "Stammdaten bearbeiten" }).click();
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Vorsorge & Vertretung" }) });
  await card.getByRole("combobox", { name: "Patientenverfügung" }).click();
  await page.getByRole("option", { name: "Liegt vor" }).click();
  await pickDate(card, "Verfasst am", "2025-05-12");
  await card.getByLabel("Aufbewahrungsort").fill("Original bei der Tochter");
  await page.getByRole("button", { name: "Stammdaten speichern" }).click();
  await expect(page.getByRole("button", { name: "Stammdaten bearbeiten" })).toBeVisible();
  await expect(header.locator(".record-advance-care")).toHaveText("PV: Ja");

  // Vertretungsberechtigte Person über die Kontaktpersonen.
  await page.getByRole("button", { name: "Kontakt hinzufügen" }).click();
  const dialog = page.getByRole("dialog", { name: "Kontaktperson hinzufügen" });
  await dialog.getByLabel("Name").fill("Petra Muster");
  await dialog.getByLabel("Telefon").fill("+41 79 222 22 22");
  await dialog.getByRole("combobox", { name: "Vertretungsberechtigt als" }).click();
  await page.getByRole("option", { name: "Vorsorgebeauftragte Person" }).click();
  await dialog.getByRole("button", { name: "Kontaktperson hinzufügen" }).click();
  await expect(header.locator(".record-representative")).toHaveText("Vertretung: Petra Muster");
  await expect(card).toContainText("Petra Muster · Vorsorgebeauftragte Person");

  // Das FBM-Formular übernimmt die Vertretung.
  await page.locator(".resident-record-tabs button", { hasText: "FBM" }).click();
  await page.getByRole("button", { name: "Massnahme erfassen" }).click();
  await expect(
    page.getByRole("dialog", { name: "Massnahme erfassen" }).getByLabel("Vertretungsberechtigte Person"),
  ).toHaveValue("Petra Muster");
  expect(errors).toEqual([]);
});
