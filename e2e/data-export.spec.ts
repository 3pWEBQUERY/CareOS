import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ADMIN, FAGE, login, watchErrors } from "./support";

// Auskunft & Datenexport: die Administration erstellt im Verlauf der Akte eine Auskunft als Datei und als lesbare
// Fassung; die Pflege sieht die Karte nicht.
test("Auskunft: Datei (JSON) und lesbare Fassung, nur Administration", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  await page.locator(".resident-record-tabs button", { hasText: "Verlauf" }).click();
  const card = page.getByRole("region", { name: "Auskunft & Datenexport" });
  await card.getByRole("button", { name: "Auskunft erstellen" }).click();
  const dialog = page.getByRole("dialog", { name: "Auskunft erstellen" });
  await expect(dialog).toContainText("DSG Art. 25");
  await dialog.getByLabel("Verlangt von").fill("Tochter (Klicktest)");
  await dialog.getByRole("button", { name: "Datei, maschinenlesbar (JSON)" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Datei herunterladen" }).click(),
  ]);
  const json = JSON.parse(readFileSync((await download.path())!, "utf8")) as {
    format: string;
    requestedBy: string;
    resident: { name: string };
    sections: Array<{ key: string; rows: unknown[] }>;
  };
  expect(json.format).toBe("carecore-auskunft");
  expect(json.requestedBy).toBe("Tochter (Klicktest)");
  expect(json.sections.find((section) => section.key === "resident")?.rows).toHaveLength(1);

  await card.getByRole("button", { name: "Auskunft erstellen" }).click();
  await dialog.getByLabel("Verlangt von").fill("Person selbst");
  const [sheet] = await Promise.all([
    page.context().waitForEvent("page"),
    dialog.getByRole("button", { name: "Lesbare Fassung öffnen" }).click(),
  ]);
  const sheetErrors = watchErrors(sheet);
  await expect(sheet.getByRole("heading", { level: 1 })).toHaveText(json.resident.name);
  await expect(sheet.locator(".export-sheet")).toContainText("verlangt von Person selbst");
  await expect(sheet.getByRole("heading", { name: "Stammdaten", level: 2 })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Änderungsprotokoll der Akte", level: 2 })).toBeVisible();
  expect(sheetErrors).toEqual([]);
  expect(errors).toEqual([]);

  await page.context().clearCookies();
  await login(page, FAGE);
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  await page.locator(".resident-record-tabs button", { hasText: "Verlauf" }).click();
  await expect(page.locator(".resident-record-tabs")).toBeVisible();
  await expect(page.locator(".record-export-card")).toHaveCount(0);
});
