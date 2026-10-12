import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Weisung veröffentlichen: Datei über die eigene Ablagefläche wählen (nicht die Auswahl des Browsers).
test("Standards: Weisung mit Datei über die Ablagefläche veröffentlichen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const title = `E2E Weisung ${Date.now()}`;
  await page.goto("/c/personal/dokumente/standards");
  await page.getByRole("button", { name: "Weisung veröffentlichen" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Weisung veröffentlichen" });
  await expect(dialog.locator(".document-file-drop")).toContainText("Datei auswählen");
  await dialog.getByLabel("Titel").fill(title);
  await dialog.getByRole("button", { name: "Freigeben & veröffentlichen" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Bitte eine Datei auswählen.");
  const input = dialog.getByLabel("Datei", { exact: true });
  await input.setInputFiles({ name: "Archiv.zip", mimeType: "application/zip", buffer: Buffer.from("PK\u0003\u0004") });
  await expect(dialog.getByRole("alert")).toContainText("Office-Dokument");
  await input.setInputFiles({
    name: "Händehygiene.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n"),
  });
  await expect(dialog.locator(".document-file-selected")).toContainText("Händehygiene.pdf");
  await expect(dialog.locator(".document-file-selected")).toContainText("PDF");
  await expect(dialog.getByLabel("Titel")).toHaveValue(title);
  await dialog.getByRole("button", { name: "Freigeben & veröffentlichen" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(title).first()).toBeVisible();
  expect(errors).toEqual([]);
});
