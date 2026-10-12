import { expect, test } from "@playwright/test";
import { ADMIN, field, login, watchErrors } from "./support";

// Vorlagen der Einrichtung erfassen und beim Planen übernehmen (Kopie, anpassbar).
test("Pflegeplanung: Standardplan und Massnahmenkatalog erfassen, Ziel aus Vorlage übernehmen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/pflegeplanung/vorlagen");
  await expect(page.getByRole("heading", { name: "Vorlagen", level: 1 })).toBeVisible();

  // Massnahme in den Katalog.
  await page.getByRole("button", { name: "Neue Massnahme" }).click();
  let dialog = page.getByRole("dialog", { name: "Massnahme in den Katalog" });
  await dialog.getByRole("combobox", { name: "Pflegebereich" }).click();
  await page.getByRole("option", { name: "Mobilität", exact: true }).click();
  await dialog.getByLabel("Massnahme", { exact: true }).fill(`Hüftprotektor anziehen ${stamp}`);
  await dialog.getByLabel("Häufigkeit", { exact: true }).fill("morgens");
  await dialog.getByRole("group", { name: "Nachweis je Tageszeit" }).getByRole("button", { name: "Morgen" }).click();
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Massnahmenkatalog" })).toContainText(`Hüftprotektor anziehen ${stamp}`);

  // Standardplan mit einer eigenen und einer Massnahme aus dem Katalog.
  await page.getByRole("button", { name: "Neuer Standardplan" }).click();
  dialog = page.getByRole("dialog", { name: "Neuer Standardplan" });
  await dialog.getByLabel("Name der Vorlage").fill(`Sturzgefahr ${stamp}`);
  await dialog.getByRole("combobox", { name: "Pflegebereich" }).click();
  await page.getByRole("option", { name: "Mobilität", exact: true }).click();
  await dialog.getByLabel("Überprüfung nach Tagen (optional)").fill("21");
  await dialog.getByLabel("Pflegeproblem").fill("Unsicherer Gang, Angst vor Sturz");
  await dialog.getByLabel("Ziel", { exact: true }).fill("Geht mit Rollator 20 m sicher im Korridor");
  await dialog.getByRole("button", { name: "Massnahme", exact: true }).click();
  await dialog.getByLabel("Massnahme 1", { exact: true }).fill("Begleitetes Gehtraining");
  await dialog.getByLabel("Häufigkeit 1", { exact: true }).fill("täglich");
  await dialog.getByRole("combobox", { name: "Aus dem Katalog" }).click();
  await page.getByRole("option", { name: new RegExp(`Hüftprotektor anziehen ${stamp}`) }).click();
  await expect(dialog.getByLabel("Massnahme 2", { exact: true })).toHaveValue(`Hüftprotektor anziehen ${stamp}`);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  const plans = page.getByRole("list", { name: "Standardpläne" });
  await expect(plans).toContainText(`Sturzgefahr ${stamp}`);
  await expect(plans).toContainText("Überprüfung nach 21 Tagen · 2 Massnahmen");

  // Beim Planen übernehmen: Person wählen, Plan anlegen falls nötig, Ziel aus der Vorlage mit einer Massnahme.
  await page.goto("/c/pflegeplanung");
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^[A-ZÄÖÜ]{1,2} Bewohner / })
    .click();
  const picker = page.getByRole("dialog", { name: "Bewohner auswählen" });
  await picker.getByRole("button", { name: "Alle Wohnbereiche" }).click();
  await picker.getByLabel("Bewohner suchen").fill("Walter Brunner");
  await picker
    .getByRole("button", { name: /Walter Brunner/ })
    .first()
    .click();
  const addGoal = page.getByRole("button", { name: "Pflegeziel hinzufügen" }).first();
  const createPlan = page.getByRole("button", { name: "Pflegeplan anlegen" }).first();
  await expect(addGoal.or(createPlan)).toBeVisible();
  if (await createPlan.isVisible()) {
    await createPlan.click();
    await field(page, "Pflegefokus").fill("Sicherheit im Alltag");
    await page.locator(".editor-dialog").getByRole("button", { name: "Pflegeplan anlegen" }).click();
    await expect(page.locator(".editor-dialog")).toHaveCount(0);
  }
  await addGoal.click();
  dialog = page.getByRole("dialog", { name: "Pflegeziel hinzufügen" });
  await dialog.getByRole("combobox", { name: "Vorlage" }).click();
  await page.getByRole("option", { name: new RegExp(`Sturzgefahr ${stamp}`) }).click();
  await expect(dialog.getByLabel("Pflegeproblem")).toHaveValue("Unsicherer Gang, Angst vor Sturz");
  const picks = dialog.getByRole("group", { name: "Massnahmen aus der Vorlage" });
  await expect(picks.getByRole("button", { pressed: true })).toHaveCount(2);
  await picks.getByRole("button", { name: /Hüftprotektor anziehen/ }).click();
  await dialog.getByLabel("Pflegeproblem").fill("Unsicherer Gang seit dem Spitalaufenthalt");
  await dialog.getByRole("button", { name: "Ziel hinzufügen" }).click();
  await expect(dialog).toHaveCount(0);
  const goal = page.locator("article", { hasText: "Unsicherer Gang seit dem Spitalaufenthalt" }).first();
  await expect(goal).toContainText("Begleitetes Gehtraining");
  await expect(goal).not.toContainText("Hüftprotektor anziehen");
  expect(errors).toEqual([]);
});
