import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Hilfsmittel und persönliche Gegenstände: erfassen, im Überleitungsbogen zum Abhaken, nicht mehr vorhanden.
test("Hilfsmittel & Gegenstände: erfassen, im Überleitungsbogen, nicht mehr vorhanden", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const marking = `Etui ${Date.now().toString().slice(-5)}`;
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").nth(4).click();
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  const card = page.getByRole("region", { name: "Hilfsmittel & Gegenstände" });
  await card.getByRole("button", { name: "Hilfsmittel oder Gegenstand erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Hilfsmittel oder Gegenstand erfassen" });
  await dialog.getByRole("button", { name: "Hörgerät" }).click();
  await expect(dialog.getByLabel("Gegenstand")).toHaveValue("Hörgerät");
  await dialog.getByLabel("Kennzeichnung").fill(marking);
  await dialog.getByRole("combobox", { name: "Standort" }).click();
  await page.getByRole("option", { name: "Nachttisch", exact: true }).click();
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  const item = card.locator("li", { hasText: marking });
  await expect(item).toContainText("Standort: Nachttisch");

  const href = await page.locator(".record-transfer-link").getAttribute("href");
  const residentId = new URL(href ?? "", "http://x").searchParams.get("resident");
  await page.goto(href ?? "");
  await expect(page.locator(".transfer-belongings")).toContainText(`Hörgerät (${marking})`);

  await page.goto(`/c/bewohner?resident=${residentId}`);
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  await item.getByRole("button", { name: "Hörgerät nicht mehr vorhanden" }).click();
  const remove = page.getByRole("dialog", { name: "Nicht mehr vorhanden" });
  await remove.getByLabel("Grund").fill("der Tochter mitgegeben");
  await remove.getByRole("button", { name: "Vermerken" }).click();
  await expect(remove).toHaveCount(0);
  await expect(
    card.getByRole("list", { name: "Vorhandene Hilfsmittel und Gegenstände" }).locator("li", { hasText: marking }),
  ).toHaveCount(0);
  await card.getByText(/Nicht mehr vorhanden \(/).click();
  await expect(card.getByRole("list", { name: "Nicht mehr vorhanden" })).toContainText("der Tochter mitgegeben");
  expect(errors).toEqual([]);
});
