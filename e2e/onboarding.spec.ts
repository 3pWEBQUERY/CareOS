import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Einarbeitung: Checkliste für alle Rollen festlegen, Einarbeitung starten, Punkt abzeichnen.
test("Einarbeitung: Checkliste festlegen, starten, abzeichnen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const item = `Rundgang durch das Haus ${Date.now().toString().slice(-5)}`;
  await page.goto("/c/leitung/teamleitung/einarbeitung");
  await expect(page.getByRole("heading", { name: "Einarbeitung", level: 1 })).toBeVisible();

  const lists = page.getByRole("region", { name: "Checklisten je Rolle" });
  await lists.getByRole("button", { name: /^Alle Rollen/ }).click();
  await lists.getByRole("button", { name: /^(Festlegen|Bearbeiten)$/ }).click();
  const listDialog = page.getByRole("dialog", { name: "Checkliste: Alle Rollen" });
  await listDialog.getByLabel("Punkte").fill(`${item}\nBrandschutz und Fluchtwege`);
  await listDialog.getByRole("button", { name: "Checkliste speichern" }).click();
  await expect(listDialog).toHaveCount(0);
  await expect(lists).toContainText(item);

  await page.getByRole("button", { name: "Einarbeitung starten" }).click();
  const start = page.getByRole("dialog", { name: "Einarbeitung starten" });
  await start.getByRole("combobox", { name: "Neue mitarbeitende Person" }).click();
  await page.getByRole("option").first().click();
  const chosen = (await start.getByRole("combobox", { name: "Neue mitarbeitende Person" }).innerText()).split(" · ")[0];
  await start.getByRole("combobox", { name: "Einarbeitung durch" }).click();
  await page.getByRole("option").nth(1).click();
  await start.getByRole("button", { name: "Einarbeitung starten" }).click();
  await expect(start).toHaveCount(0);

  const row = page.getByRole("listitem", { name: chosen.trim() });
  await expect(row).toContainText("0 von");
  await row.getByRole("button", { name: `${item} abzeichnen` }).click();
  const sign = page.getByRole("dialog", { name: "Punkt abzeichnen" });
  await sign.getByLabel("Bemerkung").fill("gemeinsam durchgeführt");
  await sign.getByRole("button", { name: "Abzeichnen" }).click();
  await expect(sign).toHaveCount(0);
  await expect(row).toContainText("1 von");
  await expect(row).toContainText("gemeinsam durchgeführt");
  await expect(row.getByRole("button", { name: /abschliessen$/ })).toBeDisabled();
  expect(errors).toEqual([]);
});
