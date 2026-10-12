import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Diagnosen in den Stammdaten: erfassen, im Überleitungsbogen sehen, abschliessen.
test("Diagnosen: erfassen, im Überleitungsbogen, abschliessen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const label = `Morbus Parkinson ${Date.now().toString().slice(-5)}`;
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").nth(3).click();
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  const card = page.getByRole("region", { name: "Diagnosen" });
  await card.getByRole("button", { name: "Diagnose erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Diagnose erfassen" });
  await dialog.getByLabel("Diagnose", { exact: true }).fill(label);
  await dialog.getByLabel("ICD-10-Code (freiwillig)").fill("g20");
  await dialog.getByLabel("Quelle").fill("Austrittsbericht Spital");
  await dialog.getByRole("button", { name: "Diagnose speichern" }).click();
  await expect(dialog).toHaveCount(0);
  const current = card.getByRole("list", { name: "Aktuelle Diagnosen" }).locator("li", { hasText: label });
  await expect(current).toContainText("G20");
  await expect(current).toContainText("Quelle: Austrittsbericht Spital");

  const href = await page.locator(".record-transfer-link").getAttribute("href");
  const residentId = new URL(href ?? "", "http://x").searchParams.get("resident");
  await page.goto(href ?? "");
  await expect(page.locator(".transfer-diagnoses")).toContainText(`${label} (G20)`);

  await page.goto(`/c/bewohner?resident=${residentId}`);
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  await current.getByRole("button", { name: `${label} bearbeiten` }).click();
  const edit = page.getByRole("dialog", { name: "Diagnose bearbeiten" });
  await edit.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Abgeschlossen" }).click();
  await edit.getByRole("button", { name: "Diagnose speichern" }).click();
  await expect(edit).toHaveCount(0);
  await expect(current).toHaveCount(0);
  await card.getByText(/Abgeschlossene Diagnosen/).click();
  await expect(card.getByRole("list", { name: "Abgeschlossene Diagnosen" })).toContainText(label);
  expect(errors).toEqual([]);
});
