import { expect, test } from "@playwright/test";
import { ADMIN, login, pickDate, watchErrors } from "./support";

test.describe.configure({ mode: "serial" });

// Abrechnung, Grundlagen: Taxen der Einrichtung, Pflegetarif, Stufe und Abwesenheit je Person mit Monatsvorschau.
test("Abrechnung: Taxen erfassen, Stufe und Abwesenheit je Person, Vorschau des Monats", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  const firstOfMonth = `${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" }).slice(0, 7)}-01`;
  await page.goto("/c/bewohner/abrechnung");
  await expect(page.getByRole("heading", { name: "Abrechnung", level: 1 })).toBeVisible();

  // Taxen der Einrichtung: Regel zum Austrittstag, eine Taxe mit Regel bei Spitalaufenthalt, ein Pflegetarif.
  await page.getByRole("button", { name: "Taxen der Einrichtung" }).click();
  const discharge = page.getByRole("group", { name: "Austrittstag" });
  await discharge.getByRole("button", { name: "Austrittstag nicht verrechnen" }).click();
  await expect(discharge.getByRole("button", { name: "Austrittstag nicht verrechnen" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Neue Taxe" }).click();
  let dialog = page.getByRole("dialog", { name: "Neue Taxe" });
  await dialog.getByLabel("Bezeichnung").fill(`Pension ${stamp}`);
  await dialog.getByRole("combobox", { name: "Art" }).click();
  await page.getByRole("option", { name: "Pension" }).click();
  await dialog.getByRole("combobox", { name: "Bezahlt von" }).click();
  await page.getByRole("option", { name: "Person selbst" }).click();
  await dialog.getByLabel("Preis je Tag (CHF)").fill("120");
  await pickDate(dialog, "Gültig ab", firstOfMonth);
  await dialog.getByRole("group", { name: "Bei Spitalaufenthalt" }).getByRole("button", { name: "Reduzieren" }).click();
  await dialog.getByLabel("Tage voll verrechnet").first().fill("3");
  await dialog.getByLabel("Danach verrechnet (%)").first().fill("50");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  const rates = page.getByRole("list", { name: "Taxen" });
  const row = rates.getByRole("listitem").filter({ hasText: `Pension ${stamp}` });
  await expect(row).toContainText("CHF 120.00");
  await expect(row).toContainText("Spital: 3 Tage voll, danach 50 %");

  await page.getByRole("button", { name: "Pflegestufe 3 · Krankenversicherung" }).click();
  dialog = page.getByRole("dialog", { name: /Pflegetarif erfassen|Taxe bearbeiten/ });
  await dialog.getByLabel("Preis je Tag (CHF)").fill("28.80");
  await pickDate(dialog, "Gültig ab", firstOfMonth);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pflegestufe 3 · Krankenversicherung" })).toContainText("CHF 28.80");

  // Je Bewohner: Person aus der Kopfzeile, Stufe und Abwesenheit erfassen.
  await page.getByRole("button", { name: "Je Bewohner" }).click();
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^[A-ZÄÖÜ]{1,2} Bewohner / })
    .click();
  const picker = page.getByRole("dialog", { name: "Bewohner auswählen" });
  await picker.getByRole("button", { name: "Alle Wohnbereiche" }).click();
  await picker.getByLabel("Bewohner suchen").fill("Hans Müller");
  await picker
    .getByRole("button", { name: /Hans Müller/ })
    .first()
    .click();
  await expect(picker).toHaveCount(0);
  const preview = page.locator(".billing-preview");
  await expect(preview).toContainText(`Pension ${stamp}`);

  await page.getByRole("button", { name: "Neue Stufe" }).click();
  dialog = page.getByRole("dialog", { name: "Pflegestufe erfassen" });
  await dialog.getByRole("combobox", { name: "Pflegestufe" }).click();
  await page.getByRole("option", { name: /^Pflegestufe 3 ·/ }).click();
  await pickDate(dialog, "Gültig ab", firstOfMonth);
  await dialog.getByLabel("Grundlage (optional)").fill("Einstufung");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Verlauf Pflegestufe" })).toContainText("Pflegestufe 3");
  await expect(preview).toContainText("Pflegestufe 3 · Krankenversicherung");
  await expect(preview).toContainText("Total Monat");

  await page.getByRole("region", { name: "Abwesenheiten" }).getByRole("button", { name: "Erfassen" }).click();
  dialog = page.getByRole("dialog", { name: "Abwesenheit erfassen" });
  await dialog.getByRole("button", { name: "Spital" }).click();
  await pickDate(dialog, "Erster ganzer Tag", firstOfMonth);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  const absences = page.getByRole("list", { name: "Abwesenheiten" });
  await expect(absences).toContainText("Spital");
  await expect(absences.getByRole("button", { name: "Rückkehr eintragen" })).toBeVisible();
  await expect(preview).toContainText("Spitaltage zu 50 %");

  // Stornieren mit Grund.
  await absences.getByRole("button", { name: "Stornieren" }).click();
  dialog = page.getByRole("dialog", { name: "Eintrag stornieren" });
  await dialog.getByLabel("Grund der Stornierung").fill("Testeintrag");
  await dialog.getByRole("button", { name: "Stornieren" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Abwesenheiten" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Abrechnung: Zahlungsangaben, Rechnungsadresse und Rechnungslauf", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page, [/^400 PUT \/api\/billing\/invoices\/settings$/]);
  await page.goto("/c/bewohner/abrechnung");
  await page.getByRole("button", { name: "Rechnungen" }).click();
  await expect(page.getByRole("heading", { name: /^Rechnungen / })).toBeVisible();

  // Zahlungsangaben der Einrichtung und Regel zum Austrittstag (unter „Taxen der Einrichtung“).
  await page.getByRole("button", { name: "Taxen der Einrichtung" }).click();
  await page
    .getByRole("group", { name: "Austrittstag" })
    .getByRole("button", { name: "Austrittstag nicht verrechnen" })
    .click();
  const payment = page.getByRole("region", { name: "Zahlungsangaben" });
  await payment.getByRole("button", { name: /Erfassen|Bearbeiten/ }).click();
  let dialog = page.getByRole("dialog", { name: "Zahlungsangaben der Einrichtung" });
  await dialog.getByLabel("Name", { exact: true }).fill("Heim Sonnenhalde");
  await dialog.getByLabel("Strasse").fill("Seeweg");
  await dialog.getByLabel("Hausnummer (optional)").fill("4");
  await dialog.getByLabel("Postleitzahl").fill("8000");
  await dialog.getByLabel("Ort").fill("Zürich");
  await dialog.getByLabel("IBAN").fill("CH00 1234");
  await dialog.getByLabel("Zahlungsfrist (Tage)").fill("30");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog.getByRole("alert")).toContainText("IBAN ist ungültig");
  await dialog.getByLabel("IBAN").fill("CH44 3199 9123 0008 8901 2");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(payment).toContainText("IBAN …9012");
  await expect(payment).toContainText("zahlbar innert 30 Tagen");

  // Rechnungsadresse je Person.
  await page.getByRole("button", { name: "Je Bewohner" }).click();
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^[A-ZÄÖÜ]{1,2} Bewohner / })
    .click();
  const picker = page.getByRole("dialog", { name: "Bewohner auswählen" });
  await picker.getByRole("button", { name: "Alle Wohnbereiche" }).click();
  await picker.getByLabel("Bewohner suchen").fill("Hans Müller");
  await picker
    .getByRole("button", { name: /Hans Müller/ })
    .first()
    .click();
  const addressCard = page.getByRole("region", { name: "Rechnungsadresse" });
  await addressCard.getByRole("button", { name: /Erfassen|Ändern/ }).click();
  dialog = page.getByRole("dialog", { name: "Rechnungsadresse" });
  await dialog.getByLabel("Name", { exact: true }).fill("Claudia Müller");
  await dialog.getByLabel("Zusatz (optional, z. B. c/o Beistandschaft)").fill("für Hans Müller");
  await dialog.getByLabel("Strasse").fill("Bergstrasse");
  await dialog.getByLabel("Postleitzahl").fill("8001");
  await dialog.getByLabel("Ort").fill("Zürich");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(addressCard).toContainText("Claudia Müller · für Hans Müller · Bergstrasse · 8001 Zürich");

  // Rechnungslauf: der Vormonat ist wählbar; ohne fehlende Angaben kein Hinweis.
  await page.getByRole("button", { name: "Rechnungen" }).click();
  await expect(page.getByRole("heading", { name: /^Rechnungen / })).toBeVisible();
  await expect(page.getByText("Bevor Rechnungen erstellt werden können")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Rechnungen erstellen/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Offene Posten" })).toBeVisible();

  // Bankdatei: Gutschrift ohne passende Rechnung wird nur angezeigt, nicht verbucht.
  await page.getByRole("button", { name: "Bankdatei einlesen" }).click();
  dialog = page.getByRole("dialog", { name: "Bankdatei einlesen" });
  await dialog.getByLabel("Bankdatei (XML)").setInputFiles({
    name: "gutschriften.xml",
    mimeType: "application/xml",
    buffer: Buffer.from(
      `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.08"><BkToCstmrDbtCdtNtfctn><Ntfctn>
      <Ntry><Amt Ccy="CHF">120.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-05</Dt></BookgDt>
      <AcctSvcrRef>E2E-${Date.now()}</AcctSvcrRef><NtryDtls><TxDtls><Amt Ccy="CHF">120.00</Amt>
      <RltdPties><Dbtr><Pty><Nm>Claudia Müller</Nm></Pty></Dbtr></RltdPties>
      <RmtInf><Strd><CdtrRefInf><Ref>RF18539007547034</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>
      </Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`,
    ),
  });
  await expect(dialog).toContainText("gutschriften.xml: 1 Gutschrift, davon 0 zuordenbar.");
  await expect(dialog.getByRole("row", { name: /Claudia Müller/ })).toContainText("Keine passende Rechnung");
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
