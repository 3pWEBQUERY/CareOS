import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Eigene Einschätzungsinstrumente: die Administration hinterlegt ein Instrument mit Quelle; die Pflege erfasst damit
// eine Einschätzung, CareOS zählt die Punkte der Einrichtung zusammen.
test("Eigene Instrumente: anlegen, damit einschätzen, nicht mehr anbieten", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const name = `Hausinstrument ${Date.now()}`;

  await page.goto("/c/leitung/administration/konfiguration");
  const card = page.getByRole("region", { name: "Eigene Instrumente" });
  await card.getByRole("button", { name: "Instrument anlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Instrument anlegen" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Quelle und Nutzungsrecht").fill("Eigenes Formular, Fassung 2026");
  await dialog.getByLabel("Nächste Einschätzung nach (Tagen)").fill("14");
  await dialog.getByLabel("Frage", { exact: true }).fill("Unruhe");
  await dialog.getByLabel("Antworten (je Zeile: Punkte = Text)").fill("0 = keine\n1 = etwas\n2 = deutlich");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  const row = card.locator(".admin-retention-row", { hasText: name });
  await expect(row).toContainText("Fassung 1 · 1 Frage · Quelle: Eigenes Formular, Fassung 2026");

  await page.goto("/c/einschaetzungen");
  await page.getByRole("button", { name: "Einschätzung erfassen" }).click();
  const assessment = page.locator(".editor-dialog");
  await assessment.getByRole("combobox", { name: "Instrument" }).click();
  await page.getByRole("option", { name }).click();
  await expect(assessment).toContainText("Quelle: Eigenes Formular, Fassung 2026");
  await assessment.getByRole("button", { name: "deutlich (2)" }).click();
  await expect(assessment.locator(".assessment-score")).toContainText("2 Punkte");
  await assessment.getByRole("button", { name: "Einschätzung abschliessen" }).click();
  await expect(page.locator(".toast")).toContainText(`${name} 2 Punkte`);

  await page.goto("/c/leitung/administration/konfiguration");
  await row.getByRole("button", { name: "Nicht mehr anbieten" }).click();
  const remove = page.getByRole("dialog", { name: "Instrument nicht mehr anbieten" });
  await remove.getByLabel("Grund").fill("Klicktest");
  await remove.getByRole("button", { name: "Nicht mehr anbieten" }).click();
  await expect(row).toContainText("Nicht mehr angeboten");
  expect(errors).toEqual([]);
});
