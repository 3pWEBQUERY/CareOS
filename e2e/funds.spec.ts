import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Bewohnergelder: Einzahlung und Ausgabe buchen, zu hohe Auszahlung abgewiesen, Storno mit Grund, Kassenkontrolle
// mit erklärter Differenz und Kontoauszug des Monats.
test("Bewohnergelder: buchen, stornieren, Kassenkontrolle und Kontoauszug", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/bewohner/gelder");
  await expect(page.getByRole("heading", { name: "Bewohnergelder", level: 1 })).toBeVisible();
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^[A-ZÄÖÜ]{1,2} Bewohner / })
    .click();
  const picker = page.getByRole("dialog", { name: "Bewohner auswählen" });
  await picker.getByRole("button", { name: "Alle Wohnbereiche" }).click();
  await picker.getByLabel("Bewohner suchen").fill("Maria Keller");
  await picker
    .getByRole("button", { name: /Maria Keller/ })
    .first()
    .click();
  await expect(picker).toHaveCount(0);
  const entries = page.locator(".fund-entries");
  await expect(entries.getByRole("heading", { level: 2 })).toContainText("Buchungen");

  // Einzahlung.
  await page.getByRole("button", { name: "Buchung erfassen" }).click();
  let dialog = page.getByRole("dialog", { name: "Buchung erfassen" });
  await dialog.getByRole("button", { name: "Einzahlung" }).click();
  await dialog.getByLabel("Betrag (CHF)").fill("200");
  await dialog.getByLabel("Zweck").fill(`Taschengeld ${stamp}`);
  await dialog.getByLabel("Von (optional)").fill("Tochter");
  await expect(dialog.getByRole("status")).toContainText("Guthaben danach");
  await dialog.getByRole("button", { name: "Buchen" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(entries).toContainText(`Einzahlung · Taschengeld ${stamp}`);
  await expect(entries).toContainText("+CHF 200.00");

  // Zu hohe Auszahlung wird abgewiesen, bevor etwas gebucht wird.
  await page.getByRole("button", { name: "Buchung erfassen" }).click();
  dialog = page.getByRole("dialog", { name: "Buchung erfassen" });
  await dialog.getByRole("button", { name: "Auszahlung" }).click();
  await dialog.getByLabel("Betrag (CHF)").fill("999999.00");
  await dialog.getByLabel("Zweck").fill("zu viel");
  await dialog.getByRole("button", { name: "Buchen" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Das Guthaben reicht nicht aus");

  // Ausgabe mit Beleg.
  await dialog.getByRole("button", { name: "Ausgabe" }).click();
  await dialog.getByLabel("Betrag (CHF)").fill("45,50");
  await dialog.getByLabel("Zweck").fill(`Coiffeur ${stamp}`);
  await dialog.getByLabel("Beleg-Nr. (optional)").fill("Q-12");
  await dialog.getByRole("button", { name: "Buchen" }).click();
  await expect(dialog).toHaveCount(0);
  const expense = entries.locator("li", { hasText: `Coiffeur ${stamp}` });
  await expect(expense).toContainText("−CHF 45.50");
  await expect(expense).toContainText("Beleg Q-12");

  // Storno mit Grund: bleibt sichtbar.
  await expense.getByRole("button", { name: "Stornieren" }).click();
  const reason = page.getByRole("dialog", { name: "Buchung stornieren" });
  await reason.getByLabel("Grund der Stornierung").fill("Falsche Person");
  await reason.getByRole("button", { name: "Stornieren" }).click();
  await expect(expense).toHaveClass(/cancelled/);
  await expect(expense).toContainText("Falsche Person");

  // Kasse: das Konto erscheint; Kassenkontrolle mit Differenz nur mit Erklärung.
  const cash = page.locator(".fund-cash");
  await expect(cash.getByRole("button", { name: /Keller Maria/ })).toBeVisible();
  await cash.getByRole("button", { name: "Kassenkontrolle" }).click();
  const count = page.getByRole("dialog", { name: "Kassenkontrolle" });
  await count.getByLabel(/Gezählter Betrag/).fill("0.05");
  await expect(count.getByRole("status")).toContainText("Differenz");
  await count.getByRole("button", { name: "Speichern" }).click();
  await expect(count.getByRole("alert")).toContainText("Bitte die Differenz in der Bemerkung erklären.");
  await count.getByLabel(/Bemerkung/).fill(`Testzählung ${stamp}`);
  await count.getByRole("button", { name: "Speichern" }).click();
  await expect(count).toHaveCount(0);
  await expect(cash.locator(".fund-counts")).toContainText(`Testzählung ${stamp}`);

  // Kontoauszug des Monats: Einzahlung mit Saldo, stornierte Ausgabe nicht.
  const href = await page.getByRole("link", { name: "Kontoauszug drucken" }).getAttribute("href");
  await page.goto(`${href}&dialog=0`);
  const sheet = page.locator(".funds-sheet");
  await expect(sheet.getByRole("heading", { level: 1 })).toHaveText("Keller Maria");
  await expect(sheet).toContainText(`Einzahlung · Taschengeld ${stamp}`);
  await expect(sheet).not.toContainText(`Coiffeur ${stamp}`);
  await expect(sheet).toContainText("Anfangsbestand");
  await expect(sheet).toContainText("Endbestand");
  expect(errors).toEqual([]);
});
