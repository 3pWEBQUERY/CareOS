import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Impfungen: in den Stammdaten erfassen, im Impfstatus unter Isolation & Ausbruch sehen.
test("Impfungen: erfassen und im Impfstatus je Wohnbereich sehen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const target = `Grippe ${Date.now().toString().slice(-5)}`;
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").nth(2).click();
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  const card = page.getByRole("region", { name: "Impfungen" });
  await card.getByRole("button", { name: "Impfung erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Impfung erfassen" });
  await dialog.getByLabel("Impfung gegen").fill(target);
  await dialog.getByLabel("Charge").fill("AB123");
  await dialog.getByRole("button", { name: "Extern (z. B. Praxis, Spital)" }).click();
  await dialog.getByRole("button", { name: "Impfung speichern" }).click();
  await expect(dialog).toHaveCount(0);
  const item = card.getByRole("list", { name: "Impfungen" }).locator("li", { hasText: target });
  await expect(item).toContainText("Charge AB123 · extern");

  await page.goto("/c/bewohner/hygiene");
  const overview = page.getByRole("region", { name: "Impfstatus" });
  await overview.getByRole("button", { name: target }).click();
  const row = overview.locator("li.done");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("geimpft am");
  expect(errors).toEqual([]);
});
