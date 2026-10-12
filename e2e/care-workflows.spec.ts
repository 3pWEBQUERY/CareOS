import { expect, test } from "@playwright/test";
import { ADMIN, login, waitForNetworkIdle, watchErrors } from "./support";

// Abläufe auf Seiten, die bisher nur beim Laden geprüft wurden: Pflegeziele und Massnahmen, persönliche
// Grenzwerte der Vitalwerte, Wareneingang im Medikamentenbestand und die Pflegeakte.

test("Ziele & Massnahmen: Massnahme planen, Filter, Pausieren, Fortsetzen und Beenden", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/pflegeplanung/ziele-massnahmen");
  await expect(page.getByRole("heading", { name: "Ziele & Massnahmen", level: 1 })).toBeVisible();
  const goal = page.locator("article").filter({ has: page.getByRole("link", { name: "Maria Keller" }) });
  await goal.getByRole("button", { name: "Massnahme", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Massnahme planen" });
  await expect(dialog).toContainText("Blutzuckerwerte");
  await dialog.getByLabel("Massnahme", { exact: true }).fill(`Gehtraining ${stamp}`);
  await dialog.getByLabel("Häufigkeit").fill("2× täglich");
  await dialog.getByLabel("Durchführung").fill("Mit Rollator im Korridor, Begleitung durch Pflege.");
  await dialog.getByRole("button", { name: "Massnahme speichern" }).click();
  await expect(dialog).toHaveCount(0);
  const measure = goal.getByRole("region", { name: "Massnahmen" });
  await expect(measure).toContainText(`Gehtraining ${stamp}`);
  await expect(measure).toContainText("2× täglich");

  // Filter „Ohne Massnahmen“ zeigt das Ziel nicht mehr.
  await page.getByRole("button", { name: "Ohne Massnahmen" }).click();
  await expect(page.locator("article").filter({ hasText: `Gehtraining ${stamp}` })).toHaveCount(0);
  await page.getByRole("button", { name: "Alle", exact: true }).click();

  // Nach einem Neuladen noch da; Pausieren, Fortsetzen und Beenden.
  await page.reload();
  const reloaded = page
    .locator("article")
    .filter({ has: page.getByRole("link", { name: "Maria Keller" }) })
    .getByRole("region", { name: "Massnahmen" });
  await expect(reloaded).toContainText(`Gehtraining ${stamp}`);
  const row = reloaded.locator(".care-intervention").filter({ hasText: `Gehtraining ${stamp}` });
  await row.getByRole("button", { name: "Pausieren" }).click();
  await expect(row).toContainText("Pausiert");
  await row.getByRole("button", { name: "Fortsetzen" }).click();
  await expect(row).not.toContainText("Pausiert");
  // Beendet: bleibt als abgeschlossen sichtbar, ohne weitere Statusknöpfe.
  await row.getByRole("button", { name: "Beenden" }).click();
  await expect(row).toContainText("Abgeschlossen");
  await expect(row.getByRole("button", { name: /Beenden|Fortsetzen|Pausieren/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Vitalwerte › Grenzwerte: persönlichen Zielbereich festlegen, prüfen und entfernen", async ({ page }) => {
  await login(page, ADMIN);
  // Der absichtlich ungültige Zielbereich wird vom Server abgewiesen.
  const errors = watchErrors(page, [/^400 POST \/api\/vitals\/thresholds$/]);
  await page.goto("/c/vitalwerte/grenzwerte");
  await expect(page.getByRole("heading", { name: "Grenzwerte", level: 1 })).toBeVisible();
  await waitForNetworkIdle(page);
  await page.getByRole("button", { name: "Persönlicher Zielbereich" }).click();
  const dialog = page.getByRole("dialog", { name: "Persönlicher Zielbereich" });
  await dialog.getByRole("combobox", { name: "Bewohner" }).click();
  await page.getByRole("option", { name: /Anna Berger/ }).click();
  await dialog.getByRole("combobox", { name: "Messwert" }).click();
  await page.getByRole("option", { name: "Puls" }).click();
  // Ungültig: Zielbereich bis kleiner als ab.
  await dialog.getByLabel("Zielbereich ab (/min)").fill("90");
  await dialog.getByLabel("Zielbereich bis (/min)").fill("60");
  await dialog.getByLabel("Begründung / ärztliche Anordnung").fill("Laut Visite vom 05.10.");
  await dialog.getByRole("button", { name: "Grenzwert speichern" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("Zielbereich ab (/min)").fill("55");
  await dialog.getByLabel("Zielbereich bis (/min)").fill("95");
  await dialog.getByLabel("Alarm über (/min)").fill("120");
  await dialog.getByRole("button", { name: "Grenzwert speichern" }).click();
  await expect(dialog).toHaveCount(0);
  const entry = page.getByRole("listitem").filter({ hasText: "Anna Berger · Puls" });
  await expect(entry).toContainText("55–95 /min");

  await page.reload();
  const again = page.getByRole("listitem").filter({ hasText: "Anna Berger · Puls" });
  await expect(again).toContainText("55–95 /min");
  await again.getByRole("button", { name: "Entfernen" }).click();
  const confirm = page.getByRole("dialog", { name: "Persönlichen Zielbereich entfernen" });
  // Entfernen verlangt eine Begründung.
  await confirm.getByRole("button", { name: "Entfernen" }).click();
  await expect(confirm.getByRole("alert")).toContainText("Begründung");
  await confirm.getByLabel("Grund").fill("Laut Visite nicht mehr erforderlich");
  await confirm.getByRole("button", { name: "Entfernen" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Anna Berger · Puls" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Medikamentenbestände: Wareneingang buchen, Bestand und Bestandsjournal", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/medikation/bestaende");
  await expect(page.getByRole("heading", { name: "Medikamentenbestände", level: 1 })).toBeVisible();
  await waitForNetworkIdle(page);
  const item = page.locator("article").filter({ hasText: "Paracetamol 500 mg" });
  const before = Number(
    (
      await item
        .getByText(/^\d+ Tabletten$/)
        .first()
        .textContent()
    )?.replace(/\D/g, ""),
  );
  await page.getByRole("button", { name: "Wareneingang" }).click();
  const dialog = page.getByRole("dialog", { name: "Wareneingang buchen" });
  await dialog.getByRole("combobox", { name: "Bestand" }).click();
  await page
    .getByRole("option", { name: /Paracetamol 500 mg/ })
    .first()
    .click();
  await dialog.getByLabel("Menge").fill("12");
  await dialog.getByLabel("Bemerkung").fill(`Lieferung ${stamp}`);
  await dialog.getByRole("button", { name: "Eingang buchen" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(item.getByText(`${before + 12} Tabletten`)).toBeVisible();
  await expect(
    page.getByText(new RegExp(`Paracetamol 500 mg \\+12 · Eingang \\(„Lieferung ${stamp}“\\)`)),
  ).toBeVisible();
  // Suche und Filter.
  await page.getByLabel("Bestände durchsuchen").fill("Paracetamol");
  await expect(page.locator("article").filter({ hasText: "Metoprolol" })).toHaveCount(0);
  await expect(item).toBeVisible();
  expect(errors).toEqual([]);
});

test("Pflegeakte: Status, Pflegebereiche und Weg in die Pflegeplanung", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner/pflegeakte");
  await expect(page.getByRole("heading", { name: "Pflegeakten", level: 1 })).toBeVisible();
  // Person mit Pflegeplanung aus den Demodaten in der Kopfzeile wählen.
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
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: "Maria Keller" })).toBeVisible();
  const status = page.getByRole("region", { name: /^Status der Pflegeakte von / });
  await expect(status).toContainText("Aktive Pflegeziele");
  await expect(status).toContainText("Nächste Evaluation");
  const area = page.getByRole("button", { name: /Aktiv$/ }).first();
  await expect(area).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Pflegeziel", { exact: true }).first()).toBeVisible();
  // Der Dialog „Pflegeakte erstellen“ bietet nur Personen ohne Pflegeakte an.
  await page.getByRole("button", { name: "Pflegeakte erstellen" }).click();
  const dialog = page.getByRole("dialog", { name: "Pflegeakte erstellen" });
  await expect(dialog).toContainText(/\d+ ohne Pflegeakte/);
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("link", { name: "Pflegeplanung öffnen" }).click();
  // Die Pflegeplanung übernimmt die Person aus dem Link und räumt danach die Adresse auf.
  await expect(page).toHaveURL(/\/pflegeplanung/);
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.getByText("Maria Keller").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Kompass-Fälligkeiten: Filter nach Zeitraum und Grund, Öffnen der Abklärung", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/kompass/faelligkeiten");
  await expect(page.getByRole("heading", { name: "Fälligkeiten", level: 1 })).toBeVisible();
  const rows = page.locator("article");
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();
  await expect(page.getByText(new RegExp(`${total} von ${total} Abklärungen`))).toBeVisible();
  // „Nach Eintritt“: Personen ohne abgeschlossene Abklärung (neu eingetreten oder erste Abklärung noch offen).
  await page.getByRole("button", { name: "Nach Eintritt" }).click();
  await expect(page.getByRole("button", { name: "Nach Eintritt" })).toHaveAttribute("aria-pressed", "true");
  await expect(rows.filter({ hasText: "Erste Abklärung nach Eintritt" }).first()).toBeVisible();
  const afterEntry = await rows.count();
  expect(afterEntry).toBeLessThanOrEqual(total);
  await expect(page.getByText(new RegExp(`${afterEntry} von ${total} Abklärungen`))).toBeVisible();
  await page.getByRole("button", { name: "Alle", exact: true }).click();
  await expect(rows).toHaveCount(total);
  await rows.first().getByRole("button", { name: "Öffnen" }).click();
  await expect(page).toHaveURL(/\/kompass\/abklaerung/);
  await expect(page.locator("h1").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Vitalwerte › Entwicklung: Messwert und Zeitraum wählen, Hinweise je Person", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/vitalwerte/entwicklung");
  await expect(page.getByRole("heading", { name: "Entwicklung", level: 1 })).toBeVisible();
  await page.getByRole("combobox", { name: "Messwert auswählen" }).click();
  await page.getByRole("option", { name: "Puls" }).click();
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /^Puls · / })).toBeVisible();
  await page.getByRole("button", { name: "90 Tage" }).click();
  await expect(page.getByRole("button", { name: "90 Tage" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "30 Tage" })).toHaveAttribute("aria-pressed", "false");
  // Zahl der Hinweise stimmt mit der Liste überein (Einzahl/Mehrzahl richtig).
  const hints = page.locator(".status-badge.attention").first();
  const text = (await hints.textContent()) ?? "";
  const count = Number(text.replace(/\D/g, ""));
  expect(text.trim()).toBe(`${count} ${count === 1 ? "Hinweis" : "Hinweise"}`);
  expect(errors).toEqual([]);
});

test("Dienstplan › Arbeitszeit: Monat wechseln, Filter und CSV-Export", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/dienstplan/arbeitszeit");
  await expect(page.getByRole("heading", { name: "Arbeitszeit", level: 1 })).toBeVisible();
  const month = page.getByRole("textbox", { name: "Monat" });
  const current = await month.inputValue();
  await page.getByRole("button", { name: "Vorheriger Monat" }).click();
  await expect(month).not.toHaveValue(current);
  const previous = await month.inputValue();
  const [year, number] = current.split("-").map(Number);
  const expected = number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
  expect(previous).toBe(expected);
  await expect(page.getByRole("link", { name: "CSV Summen" })).toHaveAttribute("href", new RegExp(`monat=${expected}`));
  await page.getByRole("button", { name: "Nächster Monat" }).click();
  await expect(month).toHaveValue(current);
  // Beide Exporte liefern eine CSV-Datei.
  for (const name of ["CSV Summen", "CSV Einträge"]) {
    const href = await page.getByRole("link", { name }).getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
  }
  await expect(page.getByRole("table").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("KI-Entwürfe: Entwurf zur Prüfung öffnen, ohne Freigabe wieder schliessen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/intelligenz/entwuerfe");
  await expect(page.getByRole("heading", { name: "KI-Entwürfe", level: 1 })).toBeVisible();
  await expect(page.getByText("Keine automatische Veröffentlichung")).toBeVisible();
  const drafts = page.locator("article");
  await expect(drafts.first()).toBeVisible();
  const count = await drafts.count();
  await expect(page.getByText(new RegExp(`${count} Vorschl(ag|äge) warte`))).toBeVisible();
  await drafts.first().getByRole("button", { name: "Prüfen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(drafts).toHaveCount(count);
  await page.getByRole("button", { name: "Aktualisieren" }).click();
  await expect(drafts).toHaveCount(count);
  expect(errors).toEqual([]);
});
