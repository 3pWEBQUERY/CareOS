import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Ersteinrichtung: Checkliste unter Leitung › Administration, Name der Einrichtung in der Konfiguration ändern
// (erscheint in der Kopfzeile), Checkliste ausblenden.
test("Ersteinrichtung: Checkliste, Name der Einrichtung, ausblenden", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/leitung/administration");
  const checklist = page.getByRole("region", { name: "CareOS einrichten" });
  await expect(checklist).toBeVisible();
  // Das Administrationskonto der Testdaten hat weder Zwei-Faktor noch Passkey.
  await expect(checklist.getByRole("listitem").filter({ hasText: "Eigenes Konto absichern" })).toContainText("offen");
  await expect(checklist.getByRole("listitem").filter({ hasText: "E-Mail-Versand" })).toContainText("erledigt");

  // Name der Einrichtung ändern und wieder zurücksetzen.
  await page.goto("/c/leitung/administration/konfiguration");
  const name = page.getByLabel("Name der Einrichtung");
  const original = await name.inputValue();
  await name.fill(`${original} Test`);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".toast")).toContainText(`Name gespeichert: ${original} Test`);
  await expect(page.locator("header").getByText(`${original} Test`).first()).toBeVisible();
  await name.fill(original);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.locator(".toast")).toContainText(`Name gespeichert: ${original}`);

  // Ausblenden gilt nach dem Neuladen; danach für die übrigen Tests wieder einblenden.
  await page.goto("/c/leitung/administration");
  await checklist.getByRole("button", { name: "Ausblenden" }).click();
  await expect(checklist).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".organization-map")).toBeVisible();
  await expect(checklist).toHaveCount(0);
  expect((await page.request.patch("/api/admin/setup", { data: { dismissed: false } })).status()).toBe(200);
  expect(errors).toEqual([]);
});
