import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Belegung & Eintritt: Zimmer anlegen, Anfrage auf die Warteliste, Eintritt planen und bestätigen.
test("Belegung & Eintritt: Warteliste, Eintritt planen und bestätigen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  const roomName = `Zimmer E2E ${stamp}`;
  const lastName = `Warteliste${stamp}`;

  await page.goto("/c/bewohner/belegung");
  await expect(page.getByRole("heading", { name: "Belegung & Eintritt", level: 1 })).toBeVisible();
  const unit = page.locator(".occupancy-unit").first();
  await unit.getByRole("button", { name: "Zimmer anlegen" }).click();
  const roomDialog = page.getByRole("dialog", { name: "Zimmer anlegen" });
  await roomDialog.getByLabel("Zimmer", { exact: true }).fill(roomName);
  await roomDialog.getByRole("button", { name: "Speichern" }).click();
  await expect(unit.locator("li", { hasText: roomName })).toContainText("1 Bett · 1 frei");

  await page.getByRole("button", { name: "Auf Warteliste setzen" }).click();
  const entryDialog = page.getByRole("dialog", { name: "Auf die Warteliste setzen" });
  await entryDialog.getByLabel("Vorname").fill("Rosa");
  await entryDialog.getByLabel("Nachname").fill(lastName);
  await entryDialog.getByLabel("Kontaktperson (optional)").fill("Paul (Sohn)");
  await entryDialog.getByRole("button", { name: "Speichern" }).click();
  const entry = page.getByRole("region", { name: "Warteliste" }).locator("li", { hasText: lastName });
  await expect(entry).toContainText("Wartet");
  await expect(entry).toContainText("Kontakt: Paul (Sohn)");

  await entry.getByRole("button", { name: "Eintritt planen" }).click();
  const admit = page.getByRole("dialog", { name: "Eintritt planen" });
  await admit.getByRole("combobox", { name: "Zimmer" }).click();
  await page.getByRole("option", { name: new RegExp(roomName) }).click();
  await admit.getByRole("button", { name: "Eintritt planen" }).click();
  const planned = page.getByRole("region", { name: "Geplante Eintritte" }).locator("li", { hasText: lastName });
  await expect(planned).toContainText(roomName);
  await expect(unit.locator("li", { hasText: roomName })).toContainText("Eintritt geplant");

  await planned.getByRole("button", { name: "Eintritt bestätigen" }).click();
  await page
    .getByRole("dialog", { name: "Eintritt bestätigen" })
    .getByRole("button", { name: "Eintritt bestätigen" })
    .click();
  await expect(planned).toHaveCount(0);
  const roomRow = unit.locator("li", { hasText: roomName });
  await expect(roomRow).toContainText(`Rosa ${lastName}`);
  await expect(roomRow).not.toContainText("Eintritt geplant");
  expect(errors).toEqual([]);
});
