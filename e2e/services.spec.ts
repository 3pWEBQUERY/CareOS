import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Leistungserfassung: Leistung im Katalog anlegen, für die Person in der Kopfzeile erfassen, in der Monatsauswertung
// wiederfinden und stornieren.
test("Leistungen: Katalog, Erfassung, Auswertung und Stornierung", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const name = `Lagerung E2E ${Date.now()}`;

  await page.goto("/c/leitung/administration/leistungskatalog");
  await page.getByRole("button", { name: "Leistung anlegen" }).click();
  const catalog = page.getByRole("dialog", { name: "Leistung anlegen" });
  await catalog.getByLabel("Bezeichnung").fill(name);
  await catalog.getByLabel("Code (optional)").fill("LG-9");
  await catalog.getByLabel("Vorschlag Minuten (optional)").fill("12");
  await catalog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("region", { name: "Leistungen im Katalog" })).toContainText(name);

  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  await page.goto("/c/pflegedokumentation/leistungen");
  await expect(page.getByRole("heading", { name: "Leistungserfassung", level: 1 })).toBeVisible();
  const residentName = ((await page.locator(".service-toolbar p").textContent()) ?? "").split(" · ")[0];
  expect(residentName).not.toBe("");

  await page.getByRole("button", { name: "Leistung erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Leistung erfassen" });
  await dialog.getByRole("combobox", { name: "Aus dem Leistungskatalog" }).click();
  await page.getByRole("option", { name: `${name} · LG-9` }).click();
  await expect(dialog.getByLabel("Zeit (Minuten)")).toHaveValue("12");
  await dialog.getByRole("button", { name: "Leistung speichern" }).click();
  const records = page.getByRole("region", { name: "Erfasste Leistungen" });
  const item = records.locator("li", { hasText: name });
  await expect(item).toContainText("12 min");
  await expect(item).toContainText("LG-9");

  await page.goto("/c/leitung/kennzahlen/leistungen");
  await expect(page.getByRole("heading", { name: "Leistungsauswertung", level: 1 })).toBeVisible();
  await expect(page.locator(".services-report-table tr", { hasText: residentName })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Einzelleistungen als CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^leistungen-\d{4}-\d{2}\.csv$/);

  await page.goto("/c/pflegedokumentation/leistungen");
  await item.getByRole("button", { name: "Stornieren" }).click();
  const reason = page.getByRole("dialog", { name: "Leistung stornieren" });
  await reason.getByRole("textbox").fill("Doppelt erfasst");
  await reason.getByRole("button", { name: "Stornieren" }).click();
  await expect(item).toContainText("Storniert: Doppelt erfasst");
  await expect(item.getByRole("button", { name: "Stornieren" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
