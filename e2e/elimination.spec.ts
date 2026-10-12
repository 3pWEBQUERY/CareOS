import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Ausscheidung & Kontinenz: Stuhlgang mit Bristol-Form erfassen, Materialwechsel, Storno.
test("Ausscheidung: Stuhlgang mit Stuhlform, Materialwechsel und Storno", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  await page.goto("/c/pflegedokumentation/ausscheidung");
  await expect(page.getByRole("heading", { name: "Ausscheidung & Kontinenz", level: 1 })).toBeVisible();
  const note = `Klicktest ${Date.now()}`;
  const pad = `Einlage ${Date.now()}`;

  await page.getByRole("button", { name: "Ausscheidung erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Ausscheidung erfassen" });
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Bitte die Art wählen.");
  await dialog.getByRole("group", { name: "Art" }).getByRole("button", { name: "Stuhlgang" }).click();
  await dialog
    .getByRole("group", { name: "Stuhlform" })
    .getByRole("button", { name: /^Typ 4/ })
    .click();
  await dialog.getByRole("group", { name: "Menge" }).getByRole("button", { name: "mittel" }).click();
  await dialog.getByLabel("Bemerkung (optional)").fill(note);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  const history = page.getByRole("region", { name: "Verlauf der Ausscheidung" });
  const item = history.locator("li", { hasText: note });
  await expect(item).toContainText("Typ 4 · wurst- oder schlangenförmig, glatt und weich");
  await expect(item).toContainText("Menge: mittel");
  await expect(page.getByRole("region", { name: "Ausscheidung", exact: true })).toContainText("heute");

  await page.getByRole("button", { name: "Ausscheidung erfassen" }).click();
  await dialog
    .getByRole("group", { name: "Art" })
    .getByRole("button", { name: "Inkontinenzmaterial gewechselt" })
    .click();
  await expect(dialog.getByRole("group", { name: "Stuhlform" })).toHaveCount(0);
  await dialog.getByLabel("Material", { exact: true }).fill(pad);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(history.locator("li", { hasText: pad })).toContainText("Inkontinenzmaterial gewechselt");

  await item.getByRole("button", { name: "Stornieren" }).click();
  const cancel = page.getByRole("dialog", { name: "Eintrag stornieren" });
  await cancel.getByLabel("Grund der Stornierung").fill("doppelt erfasst");
  await cancel.getByRole("button", { name: "Stornieren" }).click();
  await expect(item).toContainText("Storniert: doppelt erfasst");
  expect(errors).toEqual([]);
});
