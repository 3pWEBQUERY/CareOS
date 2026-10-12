import { expect, test } from "@playwright/test";
import { ADMIN, login, pickDate, watchErrors } from "./support";

// Geräte & Prüfungen: Gerät mit Frist erfassen, fällige Prüfung sehen, Prüfung mit Mängeln erfassen.
test("Geräte & Prüfungen: erfassen, fällig, Prüfung mit Mängeln, nächste Prüfung nach Frist", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const name = `Patientenlifter ${Date.now().toString().slice(-5)}`;
  await page.goto("/c/leitung/qualitaet/geraete");
  await expect(page.getByRole("heading", { name: "Geräte & Prüfungen", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Gerät erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Gerät erfassen" });
  await dialog.getByLabel("Gerät", { exact: true }).fill(name);
  await dialog.getByLabel("Kategorie").fill("Lifter");
  await dialog.getByLabel("Inventarnummer").fill("INV-42");
  await dialog.getByLabel("Prüffrist (Monate)").fill("12");
  await pickDate(dialog, "Nächste Prüfung", "2026-01-15");
  await dialog.getByRole("button", { name: "Gerät speichern" }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.getByRole("listitem", { name });
  await expect(row).toContainText("Prüfung fällig seit 15.01.2026");
  await row.getByRole("button", { name: "Prüfung erfassen" }).click();
  const check = page.getByRole("dialog", { name: "Prüfung erfassen" });
  await pickDate(check, "Geprüft am", "2026-02-01");
  await expect(check.getByRole("button", { name: "Nächste Prüfung", exact: true })).toHaveText("01.02.2027");
  await check.getByLabel("Geprüft von").fill("Servicefirma Muster");
  await check.getByRole("button", { name: "Mängel" }).click();
  await check.getByLabel("Mängel").fill("Gurt eingerissen");
  await check.getByRole("button", { name: "Prüfung speichern" }).click();
  await expect(check).toHaveCount(0);
  await expect(row).toContainText("Nächste Prüfung 01.02.2027");
  await expect(row).toContainText("Mängel: Gurt eingerissen");
  expect(errors).toEqual([]);
});
