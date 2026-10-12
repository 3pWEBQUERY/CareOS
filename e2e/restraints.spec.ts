import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Freiheitsbeschränkende Massnahme in der Akte erfassen, in der Tagesliste wiederfinden, überprüfen und beenden.
test("FBM: Massnahme erfassen, Erinnerung in der Tagesliste, überprüfen und beenden", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").nth(3).click();
  await page.locator(".resident-record-tabs button", { hasText: "FBM" }).click();
  await expect(page.getByRole("heading", { name: "Freiheitsbeschränkende Massnahmen" })).toBeVisible();
  await expect(page.locator(".restraints-view")).toContainText("ZGB Art. 383–385");

  await page.getByRole("button", { name: "Massnahme erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Massnahme erfassen" });
  await dialog.getByRole("combobox", { name: "Art der Massnahme" }).click();
  await page.getByRole("option", { name: "Sensor- oder Klingelmatte" }).click();
  await dialog.getByLabel("Grund und Zweck").fill("Nächtliches Aufstehen, Sturzgefahr");
  await dialog.getByLabel("Geprüfte mildere Massnahmen").fill("Nachtlicht und Toilettengang um 2 Uhr geprüft");
  await dialog.getByLabel("Anordnende Person (Name, Funktion)").fill("Laura Leitung, Pflegedienstleitung");
  await dialog.getByRole("combobox", { name: "Haltung der Person" }).click();
  await page.getByRole("option", { name: "Nicht urteilsfähig" }).click();
  await dialog.getByLabel("Vertretungsberechtigte Person").fill("Peter Muster (Sohn)");
  await dialog.getByRole("button", { name: "Erfassen" }).click();

  const card = page.locator(".restraint-card", { hasText: "Sensor- oder Klingelmatte" });
  await expect(card).toBeVisible();
  // Überprüfung heute fällig (Vorschlag beim Erfassen) und Vertretung noch nicht informiert.
  await expect(card).toContainText("Überprüfung fällig");
  await expect(card).toContainText("Vertretung nicht informiert");
  await expect(card).toContainText("Laura Leitung, Pflegedienstleitung");

  // Die Tagesliste erinnert an beides.
  await page.keyboard.press("Escape");
  await page.goto("/c");
  const worklist = page.locator(".worklist-card");
  await expect(worklist).toContainText("FBM überprüfen");
  await expect(worklist).toContainText("Vertretung über FBM informieren");

  // Überprüfen: beenden mit Begründung.
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").nth(3).click();
  await page.locator(".resident-record-tabs button", { hasText: "FBM" }).click();
  await card.getByRole("button", { name: "Überprüfen" }).click();
  const review = page.getByRole("dialog", { name: "Massnahme überprüfen" });
  await review.getByLabel("Beenden").check();
  await review.getByLabel("Grund für das Beenden").fill("Nächtliche Begleitung genügt");
  await review.getByRole("button", { name: "Massnahme beenden" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".restraints-view")).toContainText("Keine laufende freiheitsbeschränkende Massnahme");
  await page.locator(".restraints-ended summary").click();
  await expect(page.locator(".restraints-ended")).toContainText("Nächtliche Begleitung genügt");
  expect(errors).toEqual([]);
});
