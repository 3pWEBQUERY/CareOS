import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Lohn-Export: Lohnart in den Dienstplan-Einstellungen festlegen, Personalnummer erfassen, Lohndatei herunterladen.

test("Lohn-Export: Lohnart festlegen, Personalnummer erfassen und Lohndatei herunterladen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const code = `L${Date.now() % 100000}`;
  await page.goto("/c/dienstplan/einstellungen?bereich=Lohnarten");
  await expect(page.getByRole("heading", { name: "Lohnarten" })).toBeVisible();
  await page.getByLabel("Nummer").fill(code);
  await page.getByLabel("Bezeichnung").fill("Stundenlohn Pflege");
  await page.getByRole("button", { name: "Lohnart hinzufügen" }).click();
  const table = page.getByRole("table", { name: "Lohnarten" });
  const row = table.getByRole("row").filter({ hasText: code });
  await expect(row).toContainText("Ist-Stunden");
  await expect(row).toContainText("Stunden");

  await page.getByRole("tab", { name: "Personal" }).click();
  await page.getByRole("combobox", { name: "Wohnbereich" }).click();
  await page.getByRole("option", { name: "Wohngruppe Linde" }).click();
  await page.getByRole("button", { name: "Bearbeiten" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Personalnummer (Lohn)").fill(`P-${code}`);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();

  await page.goto("/c/dienstplan/arbeitszeit");
  await expect(page.getByRole("heading", { name: "Arbeitszeit", level: 1 })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "CSV Lohn" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^arbeitszeit-lohn-.+-\d{4}-\d{2}\.csv$/);
  const body = readFileSync((await download.path())!, "utf8").replace("﻿", "");
  expect(body.split("\r\n")[0]).toBe("Periode;Personalnummer;Person;Lohnart;Bezeichnung;Menge;Einheit");

  await page.goto("/c/dienstplan/einstellungen?bereich=Lohnarten");
  await page
    .getByRole("table", { name: "Lohnarten" })
    .getByRole("row")
    .filter({ hasText: code })
    .getByRole("button", { name: "Löschen" })
    .click();
  await expect(page.getByRole("table", { name: "Lohnarten" }).getByRole("row").filter({ hasText: code })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});
