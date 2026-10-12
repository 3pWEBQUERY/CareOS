import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Isolation & Ausbruch: Ausbruch erfassen, Isolation zuordnen, überprüfen und aufheben, Ausbruch beenden.
test("Isolation & Ausbruch: erfassen, überprüfen, aufheben und Verlauf", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  const title = `Gastroenteritis E2E ${stamp}`;
  const reason = `Befund laut Labor ${stamp}`;

  await page.goto("/c/bewohner/hygiene");
  await expect(page.getByRole("heading", { name: "Isolation & Ausbruch", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Ausbruch erfassen" }).click();
  const outbreakDialog = page.getByRole("dialog", { name: "Ausbruch erfassen" });
  await outbreakDialog.getByLabel("Bezeichnung").fill(title);
  await outbreakDialog.getByLabel("Massnahmen").fill("Mahlzeiten im Zimmer");
  await outbreakDialog.getByRole("button", { name: "Speichern" }).click();
  const outbreak = page.getByRole("region", { name: `Ausbruch: ${title}` });
  await expect(outbreak).toContainText("Ganzes Haus");
  await expect(outbreak).toContainText("Meldung an die Behörde: nicht erfasst");

  await page.getByRole("button", { name: "Isolation erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Isolation erfassen" });
  await dialog.getByRole("combobox", { name: "Bewohner" }).click();
  await page.getByRole("option").first().click();
  await dialog.getByLabel("Anlass laut Anordnung").fill(reason);
  await dialog.getByLabel("Angeordnet von").fill("Dr. Meier, Hausärztin");
  await dialog.getByRole("combobox", { name: "Ausbruch" }).click();
  await page.getByRole("option", { name: title }).click();
  await dialog.getByRole("button", { name: "Erfassen" }).click();

  const row = page.locator(".isolation-row", { hasText: reason });
  await expect(row).toContainText("Kontaktisolation");
  await expect(row).toContainText("Überprüfung fällig");
  await expect(outbreak).toContainText("1 Isolation zugeordnet");

  await row.getByRole("button", { name: "Überprüfen" }).click();
  const review = page.getByRole("dialog", { name: "Isolation überprüfen" });
  await review.getByRole("combobox", { name: "Ergebnis" }).click();
  await page.getByRole("option", { name: "Aufheben" }).click();
  await review.getByLabel("Grund für das Aufheben").fill("Aufhebung laut Hausärztin");
  await review.getByRole("button", { name: "Aufheben" }).click();
  await expect(row).toHaveCount(0);
  const history = page.getByRole("region", { name: "Verlauf der letzten 90 Tage" });
  await expect(history).toContainText("Aufhebung laut Hausärztin");

  await outbreak.getByRole("button", { name: "Ausbruch beenden" }).click();
  const end = page.getByRole("dialog", { name: "Ausbruch beenden" });
  await end.getByRole("textbox").fill("Keine neuen Fälle laut Hygienefachperson");
  await end.getByRole("button", { name: "Ausbruch beenden" }).click();
  await expect(outbreak).toHaveCount(0);
  await expect(history).toContainText(`Ausbruch: ${title}`);
  expect(errors).toEqual([]);
});
