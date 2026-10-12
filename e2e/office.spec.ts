import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Ablage → Neu: Dokument (Word), Tabelle (Excel) und Präsentation (PowerPoint) aus Vorlagen anlegen, bearbeiten
// und automatisch speichern; die gespeicherten Inhalte sind nach erneutem Öffnen da.
test("Ablage: Dokument, Tabelle und Präsentation anlegen, bearbeiten und automatisch speichern", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await expect(page.getByRole("heading", { name: "Gemeinsame Ablage", level: 1 })).toBeVisible();
  const saved = page.locator(".office-status");

  // Dokument aus der Vorlage „Protokoll“.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Dokument/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neues Dokument (Word)" });
  await gallery.getByRole("radio", { name: /Protokoll/ }).click();
  await gallery.getByLabel("Name").fill(`Protokoll ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const editor = page.locator(".office-prose");
  await expect(editor.locator("h1")).toHaveText("Protokoll Teamsitzung");
  await editor.locator("h2", { hasText: "Anwesend" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Pflegeteam Ahorn");
  await expect(saved).toContainText("Gespeichert um");
  await page.getByRole("button", { name: "Version speichern" }).click();
  await expect(page.getByText("Version 2 gespeichert")).toBeVisible();
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await expect(page.locator(".files-table")).toContainText(`Protokoll ${stamp}.docx`);
  await page.getByText(`Protokoll ${stamp}.docx`, { exact: true }).dblclick();
  await expect(page.locator(".office-prose")).toContainText("Pflegeteam Ahorn");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();

  // Tabelle: Werte und Formeln, Ergebnis nach dem Speichern.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Tabelle/ }).click();
  const sheetGallery = page.getByRole("dialog", { name: "Neue Tabelle (Excel)" });
  await sheetGallery.getByLabel("Name").fill(`Werte ${stamp}`);
  await sheetGallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const grid = page.getByRole("grid", { name: "Blatt Tabelle1" });
  await grid.focus();
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await page.keyboard.type("30");
  await page.keyboard.press("Enter");
  await page.keyboard.type("=SUMME(A1:A2)");
  await page.keyboard.press("Enter");
  await expect(grid.locator("td").filter({ hasText: /^42$/ })).toHaveCount(1);
  await page.keyboard.press("ArrowUp");
  await expect(page.getByLabel("Inhalt der Zelle")).toHaveValue("=SUMME(A1:A2)");
  await expect(saved).toContainText("Gespeichert um");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Werte ${stamp}.xlsx`, { exact: true }).dblclick();
  await expect(
    page.getByRole("grid", { name: "Blatt Tabelle1" }).locator("td").filter({ hasText: /^42$/ }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();

  // Präsentation: Titel ändern, Folie hinzufügen.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Präsentation/ }).click();
  const deckGallery = page.getByRole("dialog", { name: "Neue Präsentation (PowerPoint)" });
  await deckGallery.getByRole("radio", { name: /Teamsitzung/ }).click();
  await deckGallery.getByLabel("Name").fill(`Sitzung ${stamp}`);
  await deckGallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  await expect(page.locator(".deck-thumb")).toHaveCount(5);
  await page.getByLabel("Titel der Präsentation").fill("Teamsitzung Oktober");
  await page.getByRole("button", { name: "Neue Folie" }).click();
  await page.getByRole("menuitemradio", { name: "Abschnitt" }).click();
  await expect(page.locator(".deck-thumb")).toHaveCount(6);
  await expect(saved).toContainText("Gespeichert um");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Sitzung ${stamp}.pptx`, { exact: true }).dblclick();
  await expect(page.locator(".deck-thumb")).toHaveCount(6);
  await expect(page.locator(".deck-thumb").first()).toContainText("Teamsitzung Oktober");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();

  expect(errors).toEqual([]);
});

// Dokument: Inhaltsverzeichnis folgt den Überschriften, Zeilenabstand, hoch-/tiefgestellt und Fussnoten bleiben gespeichert.
test("Dokument: Inhaltsverzeichnis, Zeilenabstand, hoch-/tiefgestellt und Fussnoten", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Dokument/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neues Dokument (Word)" });
  await gallery.getByLabel("Name").fill(`Bericht ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const editor = page.locator(".office-prose");
  await editor.click();

  await page.getByRole("button", { name: "Inhaltsverzeichnis" }).click();
  const toc = editor.locator(".office-toc");
  await expect(toc).toContainText("Noch keine Überschriften");
  await page.keyboard.press("ArrowDown");
  await page.getByRole("button", { name: "Formatvorlage" }).click();
  await page.getByRole("menuitemradio", { name: /Überschrift 1/ }).click();
  await page.keyboard.type("Einleitung");
  await expect(toc.getByRole("button", { name: "Einleitung" })).toBeVisible();
  await page.keyboard.press("Enter");

  // H₂O mit tiefgestellter 2, m² mit hochgestellter 2.
  await page.keyboard.type("H");
  await page.getByRole("button", { name: "Tiefgestellt" }).click();
  await page.keyboard.type("2");
  await page.getByRole("button", { name: "Tiefgestellt" }).click();
  await page.keyboard.type("O auf 20 m");
  await page.keyboard.press("Control+.");
  await page.keyboard.type("2");
  await expect(page.getByRole("button", { name: "Hochgestellt" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+.");
  await expect(editor.locator("sub")).toHaveText("2");
  await expect(editor.locator("sup")).toHaveText("2");

  await page.getByRole("button", { name: "Zeilenabstand" }).click();
  await page.getByRole("menuitemradio", { name: "1,5" }).click();
  await expect(editor.locator("p[data-line-spacing='1.5']")).toHaveCount(1);

  await page.getByRole("button", { name: "Fussnote" }).click();
  await page.getByLabel("Text der Fussnote").fill("Gemäss Hygienerichtlinie");
  await page.getByRole("button", { name: "Einfügen", exact: true }).click();
  await expect(editor.locator(".office-footnote")).toHaveCount(1);
  const note = page.getByLabel("Fussnote 1", { exact: true });
  await expect(note).toHaveValue("Gemäss Hygienerichtlinie");
  await note.fill("Gemäss Hygienerichtlinie 2026");

  await expect(page.locator(".office-status")).toContainText("Gespeichert um");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Bericht ${stamp}.docx`, { exact: true }).dblclick();
  const reopened = page.locator(".office-prose");
  await expect(reopened.locator(".office-toc").getByRole("button", { name: "Einleitung" })).toBeVisible();
  await expect(reopened.locator("sub")).toHaveText("2");
  await expect(reopened.locator("sup")).toHaveText("2");
  await expect(reopened.locator("p[data-line-spacing='1.5']")).toHaveCount(1);
  await expect(page.getByLabel("Fussnote 1", { exact: true })).toHaveValue("Gemäss Hygienerichtlinie 2026");
  await page.getByRole("button", { name: "Fussnote 1 löschen" }).click();
  await expect(reopened.locator(".office-footnote")).toHaveCount(0);
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  expect(errors).toEqual([]);
});

// Präsentation: freie Objekte (Textfeld, Form, Tabelle, Diagramm) einfügen, verschieben und gespeichert wiederfinden.
test("Präsentation: Textfeld, Form, Tabelle und Diagramm auf der Folie", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Präsentation/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neue Präsentation (PowerPoint)" });
  await gallery.getByLabel("Name").fill(`Objekte ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const stage = page.locator(".deck-stage");
  await expect(stage).toBeVisible();

  await page.getByRole("button", { name: "Textfeld einfügen" }).click();
  await page.keyboard.type("Freies Textfeld");
  await expect(stage.locator(".deck-item.type-text")).toContainText("Freies Textfeld");

  await page.getByRole("button", { name: "Form einfügen" }).click();
  await page.getByRole("menuitemradio", { name: "Ellipse" }).click();
  const shape = stage.locator(".deck-item.type-shape");
  await shape.dblclick();
  await page.getByLabel("Text der Form").fill("Wichtig");
  await page.keyboard.press("Escape");
  // Verschieben mit der Maus und mit den Pfeiltasten.
  const before = await shape.boundingBox();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 - 200, before!.y + before!.height / 2 + 80, { steps: 5 });
  await page.mouse.up();
  const after = await shape.boundingBox();
  expect(Math.round(before!.x - after!.x)).toBeGreaterThan(150);
  await shape.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("toolbar", { name: "Form" })).toBeVisible();
  await page.getByRole("button", { name: "Füllfarbe" }).click();
  await page.getByRole("button", { name: "Rot", exact: true }).click();

  await page.getByRole("button", { name: "Tabelle einfügen" }).click();
  await page.getByRole("button", { name: "2 Zeilen, 2 Spalten" }).click();
  await page.getByLabel("Zelle 1/1").fill("Wohnbereich");
  await page.getByLabel("Zelle 2/1").fill("Ahorn");
  await page.getByRole("button", { name: "Zeile unterhalb einfügen" }).click();
  await expect(stage.locator(".deck-item.type-table tr")).toHaveCount(3);

  await page.getByRole("button", { name: "Diagramm einfügen" }).click();
  await page.getByRole("menuitemradio", { name: "Kreis" }).click();
  const dialog = page.getByRole("dialog", { name: "Daten des Diagramms" });
  await dialog.getByLabel("Titel").fill("Verteilung");
  await dialog.getByLabel("Beschriftung 1").fill("Ahorn");
  await dialog.getByLabel("Wert 1 in Reihe 1").fill("24");
  await dialog.getByLabel("Beschriftung 2").fill("Linde");
  await dialog.getByLabel("Wert 2 in Reihe 1").fill("abc");
  await dialog.getByRole("button", { name: "Übernehmen" }).click();
  await expect(dialog.getByRole("alert")).toContainText("nur Zahlen");
  await dialog.getByLabel("Wert 2 in Reihe 1").fill("18,5");
  await dialog.getByRole("button", { name: "Übernehmen" }).click();
  await expect(stage.locator(".deck-item.type-chart svg")).toHaveAttribute("aria-label", "Verteilung");

  // Löschen mit Entf und rückgängig machen.
  await stage.locator(".deck-item.type-chart").focus();
  await page.keyboard.press("Delete");
  await expect(stage.locator(".deck-item.type-chart")).toHaveCount(0);
  await page.getByRole("button", { name: "Rückgängig", exact: true }).last().click();
  await expect(stage.locator(".deck-item.type-chart")).toHaveCount(1);

  await expect(page.locator(".office-status")).toContainText("Gespeichert um");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Objekte ${stamp}.pptx`, { exact: true }).dblclick();
  const reopened = page.locator(".deck-stage");
  await expect(reopened.locator(".deck-item")).toHaveCount(4);
  await expect(reopened.locator(".deck-item.type-text")).toContainText("Freies Textfeld");
  await expect(reopened.locator(".deck-item.type-shape")).toContainText("Wichtig");
  await expect(reopened.locator(".deck-item.type-shape svg")).toHaveAttribute("fill", /^#[0-9a-f]{6}$/);
  await expect(reopened.getByLabel("Zelle 2/1")).toHaveValue("Ahorn");
  await expect(reopened.locator(".deck-item.type-chart path")).toHaveCount(2);
  await expect(page.locator(".deck-thumb").first().locator(".deck-item")).toHaveCount(4);
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  expect(errors).toEqual([]);
});

// Tabelle: Farbskala, Datenbalken, benannter Bereich, Achsentitel/Datenbeschriftungen, Druckbereich mit Kopf-/Fusszeile.
test("Tabelle: Farbskala, Datenbalken, Namen, Achsentitel und Druckbereich", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Tabelle/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neue Tabelle (Excel)" });
  await gallery.getByLabel("Name").fill(`Kennzahlen ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const cell = (row: number, col: number) => page.locator(".sheet-table tbody tr").nth(row).locator("td").nth(col);
  const data = [
    ["Wohnbereich", "Plätze"],
    ["Ahorn", "24"],
    ["Linde", "18"],
    ["Eiche", "30"],
  ];
  for (const [row, values] of data.entries())
    for (const [col, value] of values.entries()) {
      await cell(row, col).click();
      await page.keyboard.type(value);
      await page.keyboard.press("Enter");
    }

  // Benannter Bereich und Formel mit dem Namen (Vorschlag mit Tab übernehmen).
  await page.getByRole("button", { name: "Namen verwalten" }).click();
  const names = page.getByRole("dialog", { name: "Namen verwalten" });
  await names.getByLabel("Name", { exact: true }).fill("B2");
  await names.getByRole("button", { name: "Name hinzufügen" }).click();
  await expect(names.getByRole("alert")).toContainText("Zellbezug");
  await names.getByLabel("Name", { exact: true }).fill("Plätze");
  await names.getByLabel("Bereich").fill("B2:B4");
  await names.getByRole("button", { name: "Name hinzufügen" }).click();
  await expect(names.getByRole("list", { name: "Namen" })).toContainText("Plätze");
  await names.getByRole("button", { name: "Übernehmen" }).click();
  await cell(0, 3).click();
  await page.keyboard.type("=SUMME(Plä");
  await expect(page.getByRole("option", { name: /Plätze/ })).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.type(")");
  await page.keyboard.press("Enter");
  await expect(cell(0, 3)).toHaveText("72");

  // Farbskala und Datenbalken.
  await page.getByRole("button", { name: "Bedingte Formatierung" }).click();
  const rules = page.getByRole("dialog", { name: "Bedingte Formatierung" });
  await rules.getByLabel("Bereich").fill("B2:B4");
  await rules.getByRole("combobox", { name: "Regel" }).click();
  await page.getByRole("option", { name: "Farbskala" }).click();
  await rules.getByRole("button", { name: "Regel hinzufügen" }).click();
  await rules.getByRole("combobox", { name: "Regel" }).click();
  await page.getByRole("option", { name: "Datenbalken" }).click();
  await rules.getByLabel("Bereich").fill("B2:B4");
  await rules.getByRole("button", { name: "Regel hinzufügen" }).click();
  await rules.getByRole("button", { name: "Übernehmen" }).click();
  await expect(cell(2, 1)).toHaveCSS("background-color", "rgb(248, 105, 107)");
  await expect(cell(3, 1)).toHaveCSS("background-color", "rgb(99, 190, 123)");
  await expect(cell(3, 1)).toHaveCSS("background-image", /linear-gradient/);

  // Diagramm mit Achsentiteln und Werten.
  await cell(0, 0).click();
  await cell(3, 1).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Diagramm einfügen" }).click();
  const chart = page.getByRole("dialog", { name: "Diagramm einfügen" });
  await chart.getByLabel("Titel der waagrechten Achse").fill("Wohnbereich");
  await chart.getByLabel("Titel der senkrechten Achse").fill("Anzahl");
  await chart.getByRole("button", { name: "Werte an den Datenpunkten anzeigen" }).click();
  await chart.getByRole("button", { name: "Einfügen" }).click();
  const svg = page.locator(".sheet-chart-svg").first();
  await expect(svg.locator(".sheet-chart-axis-title")).toHaveText(["Anzahl", "Wohnbereich"]);
  await expect(svg.locator(".sheet-chart-label")).toHaveText(["24", "18", "30"]);

  // Druckbereich, Kopf- und Fusszeile.
  await page.getByRole("button", { name: "Seite einrichten" }).click();
  await page.getByRole("menuitemradio", { name: /Kopf- und Fusszeile/ }).click();
  const setup = page.getByRole("dialog", { name: "Seite einrichten" });
  await setup.getByLabel("Druckbereich").fill("A1:B4");
  await setup.getByLabel("Kopfzeile").fill("Haus Ahorn");
  await setup.getByRole("button", { name: /Seitenzahlen/ }).click();
  await setup.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  const print = page.locator(".sheet-print");
  await expect(print.locator("tr")).toHaveCount(4);
  await expect(print.locator("tr").first().locator("td")).toHaveCount(2);
  const pageStyle = await print.locator("style").textContent();
  expect(pageStyle).toContain('@top-center { content: "Haus Ahorn"; }');
  expect(pageStyle).toContain("counter(pages)");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });

  await expect(page.locator(".office-status")).toContainText("Gespeichert um");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Kennzahlen ${stamp}.xlsx`, { exact: true }).dblclick();
  await expect(cell(0, 3)).toHaveText("72");
  await expect(cell(3, 1)).toHaveCSS("background-color", "rgb(99, 190, 123)");
  await expect(page.locator(".sheet-chart-svg .sheet-chart-axis-title")).toHaveCount(2);
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  expect(errors).toEqual([]);
});

// Tabelle: eingegebener Text bleibt stehen – auch beim Klick ausserhalb, auf „Fett“ oder beim Schliessen;
// Knöpfe zeigen einen eigenen Tooltip; Umbenennen im Titel.
test("Tabelle: Eingaben gehen nie verloren, Tooltips und Umbenennen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Tabelle/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neue Tabelle (Excel)" });
  await gallery.getByLabel("Name").fill(`Eingaben ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const cell = (row: number, col: number) => page.locator(".sheet-table tbody tr").nth(row).locator("td").nth(col);
  await cell(0, 0).click();
  await page.keyboard.type("Handschuhe Nitril");
  await cell(3, 2).click();
  await expect(cell(0, 0)).toHaveText("Handschuhe Nitril");
  await cell(1, 0).click();
  await page.keyboard.type("Ausserhalb");
  await page.getByLabel("Dateiname").click();
  await expect(cell(1, 0)).toHaveText("Ausserhalb");
  await cell(2, 0).click();
  await page.keyboard.type("Fett");
  await page.getByRole("button", { name: "Fett", exact: true }).click();
  await page.keyboard.press("Enter");
  await expect(cell(2, 0)).toHaveText("Fett");
  await page.getByRole("button", { name: "Kursiv", exact: true }).hover();
  await expect(page.locator(".care-tooltip.visible")).toContainText("Kursiv");
  await expect(page.locator(".care-tooltip.visible kbd")).toHaveText("Ctrl+I");
  const name = page.getByLabel("Dateiname");
  await name.fill(`Eingaben neu ${stamp}`);
  await name.press("Enter");
  await expect(name).toHaveValue(`Eingaben neu ${stamp}.xlsx`);
  // Tab, Tab, Enter wie in Excel: zurück in die Spalte, in der die Eingabe begann, eine Zeile tiefer.
  await cell(5, 1).click();
  for (const key of ["Menge", "Tab", "Preis", "Tab", "Total", "Enter", "Zweite", "Tab", "Zeile", "Enter", "Dritte"])
    await (key === "Tab" || key === "Enter" ? page.keyboard.press(key) : page.keyboard.type(key));
  await page.keyboard.press("Enter");
  await expect(cell(6, 1)).toHaveText("Zweite");
  await expect(cell(6, 2)).toHaveText("Zeile");
  await expect(cell(7, 1)).toHaveText("Dritte");
  // Mit einer Pfeiltaste dazwischen gilt die Tab-Folge nicht mehr: Enter geht gerade nach unten.
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Rechts");
  await page.keyboard.press("Enter");
  await expect(cell(9, 3)).toHaveText("Rechts");
  await cell(4, 0).click();
  // Pause länger als das automatische Speichern (1,5 s nach der Formatierung): die Eingabe bleibt offen.
  await page.keyboard.type("Beim");
  await page.waitForTimeout(2500);
  await expect(page.locator(".sheet-cell-editor")).toBeFocused();
  await page.keyboard.type(" Schliessen");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Eingaben neu ${stamp}.xlsx`, { exact: true }).dblclick();
  await expect(cell(4, 0)).toHaveText("Beim Schliessen");
  await expect(cell(0, 0)).toHaveText("Handschuhe Nitril");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  expect(errors).toEqual([]);
});

// Tabelle wie Excel: vertikale Ausrichtung, neue Funktionen, Rahmen, Filter, Auswahlliste – nach dem Speichern noch da.
test("Tabelle: vertikale Ausrichtung, Funktionen, Rahmen, Filter und Auswahlliste", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Tabelle/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neue Tabelle (Excel)" });
  await gallery.getByLabel("Name").fill(`Excel ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const cell = (row: number, col: number) => page.locator(".sheet-table tbody tr").nth(row).locator("td").nth(col);
  const rows = [
    ["Name", "Bereich", "Stunden"],
    ["Anna", "Pflege", "8"],
    ["Ben", "Küche", "6"],
    ["Cem", "Pflege", "4"],
  ];
  for (const [r, line] of rows.entries()) {
    await cell(r, 0).click();
    for (const [c, value] of line.entries()) {
      await page.keyboard.type(value);
      await page.keyboard.press(c < line.length - 1 ? "Tab" : "Enter");
    }
  }
  await cell(5, 0).click();
  await page.keyboard.type('=XVERWEIS("Ben";A2:A4;C2:C4)');
  await page.keyboard.press("Enter");
  await page.keyboard.type('=SUMMEWENNS(C2:C4;B2:B4;"Pflege")');
  await page.keyboard.press("Enter");
  await page.keyboard.type('=TEXT(DATUM(2026;10;4);"TT.MM.JJJJ")');
  await page.keyboard.press("Enter");
  await expect(cell(5, 0)).toHaveText("6");
  await expect(cell(6, 0)).toHaveText("12");
  await expect(cell(7, 0)).toHaveText("04.10.2026");
  // Überlaufende Formel füllt die Zellen darunter; die Formelleiste zeigt dort die Formel des Ursprungs.
  await cell(10, 5).click();
  await page.keyboard.type("=SEQUENZ(3;1;10;10)");
  await page.keyboard.press("Enter");
  await expect(cell(10, 5)).toHaveText("10");
  await expect(cell(11, 5)).toHaveText("20");
  await expect(cell(12, 5)).toHaveText("30");
  await expect(page.getByLabel("Inhalt der Zelle")).toHaveValue("=SEQUENZ(3;1;10;10)");
  await expect(page.locator(".sheet-spill")).toBeVisible();
  // Überlaufbezug und LAMBDA.
  await cell(14, 5).click();
  await page.keyboard.type("=SUMME(F11#)");
  await page.keyboard.press("Enter");
  await page.keyboard.type("=LET(doppelt;LAMBDA(x;x*2);doppelt(21))");
  await page.keyboard.press("Enter");
  await expect(cell(14, 5)).toHaveText("60");
  await expect(cell(15, 5)).toHaveText("42");
  // Formelhilfe: englischer Name findet NACHZEILE, mit Beispiel.
  await cell(17, 5).click();
  await page.keyboard.type("=BYR");
  await expect(page.locator(".sheet-suggest")).toContainText("NACHZEILE");
  await expect(page.locator(".sheet-suggest")).toContainText("auch BYROW");
  await page.keyboard.press("Tab");
  await expect(page.locator(".sheet-suggest-example")).toContainText("LAMBDA(zeile;SUMME(zeile))");
  await page.keyboard.press("Escape");

  // Vertikal: oben, Mitte, unten.
  await cell(0, 0).click();
  await page.getByRole("button", { name: "Oben ausrichten", exact: true }).click();
  await expect(cell(0, 0)).toHaveCSS("vertical-align", "top");
  await page.getByRole("button", { name: "Vertikal zentrieren", exact: true }).click();
  await expect(cell(0, 0)).toHaveCSS("vertical-align", "middle");

  // Rahmen unten, Filter und Auswahlliste.
  await page.getByRole("button", { name: "Rahmen", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Rahmenlinie unten" }).click();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  // Filterknopf in seiner eigenen Gestalt (nicht von anderen Regeln überdeckt).
  await expect(page.getByRole("button", { name: "Filter B" })).toHaveCSS("width", "18px");
  await page.getByRole("button", { name: "Filter B" }).click();
  await page.locator(".sheet-filter-menu").getByRole("checkbox", { name: "Küche" }).click();
  await page.locator(".sheet-filter-menu").getByRole("button", { name: "OK" }).click();
  await expect(page.locator(".sheet-table")).not.toContainText("Ben");
  await cell(9, 1).click();
  await page.getByRole("button", { name: "Auswahlliste", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Auswahlliste" });
  await dialog.getByLabel("Erlaubte Werte").fill("Ja\nNein");
  await dialog.getByRole("button", { name: "Übernehmen" }).click();
  await page.getByRole("button", { name: "Auswahlliste öffnen" }).click();
  await page.getByRole("menuitemradio", { name: "Nein" }).click();
  await expect(page.locator(".office-status")).toContainText("Gespeichert um");

  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Excel ${stamp}.xlsx`, { exact: true }).dblclick();
  await expect(page.locator(".sheet-table tbody tr").first().locator("td").first()).toHaveCSS(
    "vertical-align",
    "middle",
  );
  await expect(page.locator(".sheet-table")).not.toContainText("Ben");
  await expect(page.locator(".sheet-table")).toContainText("Nein");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  expect(errors).toEqual([]);
});

// Kommentare wie in Word, Excel und PowerPoint: an Textstelle, Zelle und Folie; Antworten, erledigt, gespeichert.
test("Kommentare in Dokument, Tabelle und Präsentation", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  const panel = page.getByRole("complementary", { name: "Kommentare" });
  const newText = page.getByRole("textbox", { name: "Neuer Kommentar" });

  // Dokument: Text markieren, kommentieren, antworten, nach dem Öffnen wieder da, erledigt.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Dokument/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neues Dokument (Word)" });
  await gallery.getByLabel("Name").fill(`Kommentiert ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const editor = page.locator(".office-prose");
  await editor.click();
  await page.keyboard.type("Blutdruck morgens messen");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+Alt+m");
  await expect(panel).toBeVisible();
  await newText.fill("Auch abends?");
  await page.getByRole("button", { name: "Kommentar senden" }).click();
  await expect(editor.locator(".office-comment-mark")).toHaveText("Blutdruck morgens messen");
  await expect(panel.getByRole("button", { name: "„Blutdruck morgens messen“" })).toBeVisible();
  await panel.getByRole("button", { name: "Antworten" }).click();
  await panel.getByRole("textbox", { name: "Antwort" }).fill("Ja, zweimal täglich.");
  await panel.getByRole("button", { name: "Antworten" }).last().click();
  await expect(panel).toContainText("Ja, zweimal täglich.");
  await expect(page.locator(".office-statusbar")).toContainText("1 offener Kommentar");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Kommentiert ${stamp}.docx`, { exact: true }).dblclick();
  await expect(panel).toContainText("Auch abends?");
  await expect(panel).toContainText("Ja, zweimal täglich.");
  await expect(page.locator(".office-prose .office-comment-mark")).toHaveText("Blutdruck morgens messen");
  await panel.getByRole("button", { name: "Erledigt" }).click();
  await expect(panel).toContainText("Alle Kommentare sind erledigt.");
  await panel.getByRole("button", { name: "Erledigte anzeigen (1)" }).click();
  await expect(panel.getByRole("button", { name: "Wieder öffnen" })).toBeVisible();
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();

  // Tabelle: Kommentar an Zelle A1 (Ctrl+Alt+M), wandert beim Einfügen einer Zeile mit nach A2.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Tabelle/ }).click();
  const sheetGallery = page.getByRole("dialog", { name: "Neue Tabelle (Excel)" });
  await sheetGallery.getByLabel("Name").fill(`Notizen ${stamp}`);
  await sheetGallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const grid = page.getByRole("grid", { name: "Blatt Tabelle1" });
  await grid.focus();
  await page.keyboard.type("Ahorn");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Control+Alt+m");
  await expect(panel.getByText("Zelle A1")).toBeVisible();
  await newText.fill("Belegung prüfen");
  await page.getByRole("button", { name: "Kommentar senden" }).click();
  await expect(grid.locator(".sheet-comment-flag")).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "Zelle A1" })).toBeVisible();
  await grid
    .locator("td")
    .filter({ hasText: /^Ahorn$/ })
    .click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Zeilen oberhalb einfügen" }).click();
  await expect(panel.getByRole("button", { name: "Zelle A2" })).toBeVisible();
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Notizen ${stamp}.xlsx`, { exact: true }).dblclick();
  await expect(panel.getByRole("button", { name: "Zelle A2" })).toBeVisible();
  await expect(panel).toContainText("Belegung prüfen");
  await expect(page.getByRole("grid", { name: "Blatt Tabelle1" }).locator(".sheet-comment-flag")).toHaveCount(1);
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();

  // Präsentation: Kommentar zur Folie, Kennzeichen in der Folienleiste.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Präsentation/ }).click();
  const deckGallery = page.getByRole("dialog", { name: "Neue Präsentation (PowerPoint)" });
  await deckGallery.getByLabel("Name").fill(`Folien ${stamp}`);
  await deckGallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  await expect(page.locator(".deck-stage")).toBeVisible();
  await page.getByRole("button", { name: "Neuer Kommentar" }).click();
  await expect(panel.getByText("Folie 1", { exact: true })).toBeVisible();
  await newText.fill("Titel kürzer fassen");
  await page.getByRole("button", { name: "Kommentar senden" }).click();
  await expect(page.locator(".deck-thumb-comments")).toHaveCount(1);
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Folien ${stamp}.pptx`, { exact: true }).dblclick();
  await expect(panel).toContainText("Titel kürzer fassen");
  await expect(panel.getByRole("button", { name: "Folie 1" })).toBeVisible();
  await panel.getByRole("button", { name: /Kommentar von .* löschen/ }).click();
  await expect(panel).toContainText("Noch keine Kommentare.");
  await expect(page.locator(".deck-thumb-comments")).toHaveCount(0);
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  expect(errors).toEqual([]);
});

// Gleichzeitiges Bearbeiten: zwei Fenster in derselben Datei sehen einander und die Änderungen des anderen;
// gleichzeitige Eingaben gehen nicht verloren (Tabelle und Dokument).
test("Gleichzeitiges Bearbeiten in Tabelle und Dokument", async ({ page, browser }) => {
  await login(page, ADMIN);
  // Speichern zweier Fenster im selben Moment wird erkannt (409) und zusammengeführt.
  const expected = [/^409 PUT \/api\/cloud\/files\//];
  const errors = watchErrors(page, expected);
  const other = await (await browser.newContext({ locale: "de-CH", timezoneId: "Europe/Zurich" })).newPage();
  await other.setViewportSize({ width: 1440, height: 950 });
  await login(other, ADMIN);
  const otherErrors = watchErrors(other, expected);
  const stamp = Date.now();

  // Tabelle anlegen und im zweiten Fenster öffnen.
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Tabelle/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neue Tabelle (Excel)" });
  await gallery.getByLabel("Name").fill(`Gemeinsam ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const grid = page.getByRole("grid", { name: "Blatt Tabelle1" });
  await grid.focus();
  await page.keyboard.type("Name");
  await page.keyboard.press("Enter");
  await expect(page.locator(".office-status")).toContainText("Gespeichert um");
  await other.goto("/c/carecore-one/ablage");
  await other.getByText(`Gemeinsam ${stamp}.xlsx`, { exact: true }).dblclick();
  const otherGrid = other.getByRole("grid", { name: "Blatt Tabelle1" });
  await expect(otherGrid.locator("td").filter({ hasText: /^Name$/ })).toHaveCount(1);

  // Beide sehen einander (gleiche Person in zwei Fenstern) und die Zelle des anderen.
  await expect(page.locator(".office-people li")).toHaveCount(1);
  await expect(other.locator(".office-people li")).toHaveCount(1);
  await otherGrid.locator("tbody tr").nth(0).locator("td").nth(2).click();
  await expect(page.locator(".sheet-remote")).toBeVisible();

  // Gleichzeitig in verschiedene Zellen schreiben: am Ende stehen beide Eingaben in beiden Fenstern.
  await page.keyboard.type("Anna");
  await page.keyboard.press("Enter");
  await other.keyboard.type("Zimmer 12");
  await other.keyboard.press("Enter");
  for (const view of [grid, otherGrid]) {
    await expect(view.locator("td").filter({ hasText: /^Anna$/ })).toHaveCount(1);
    await expect(view.locator("td").filter({ hasText: /^Zimmer 12$/ })).toHaveCount(1);
  }
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await other.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Gemeinsam ${stamp}.xlsx`, { exact: true }).dblclick();
  const reopened = page.getByRole("grid", { name: "Blatt Tabelle1" });
  for (const value of ["Name", "Anna", "Zimmer 12"])
    await expect(reopened.locator("td").filter({ hasText: new RegExp(`^${value}$`) })).toHaveCount(1);
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();

  // Dokument: beide schreiben gleichzeitig in verschiedene Absätze.
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Dokument/ }).click();
  const docGallery = page.getByRole("dialog", { name: "Neues Dokument (Word)" });
  await docGallery.getByLabel("Name").fill(`Gemeinsam ${stamp}`);
  await docGallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const prose = page.locator(".office-prose");
  await prose.click();
  await page.keyboard.type("Erster Absatz");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Zweiter Absatz");
  await expect(page.locator(".office-status")).toContainText("Gespeichert um");
  await other.goto("/c/carecore-one/ablage");
  await other.getByText(`Gemeinsam ${stamp}.docx`, { exact: true }).dblclick();
  const otherProse = other.locator(".office-prose");
  await expect(otherProse.locator("p").nth(1)).toHaveText("Zweiter Absatz");
  await otherProse.locator("p").nth(1).click();
  await other.keyboard.press("End");
  await page.locator(".office-prose p").nth(0).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" von Anna");
  await other.keyboard.type(" von Beat");
  for (const view of [prose, otherProse]) {
    await expect(view.locator("p").nth(0)).toHaveText("Erster Absatz von Anna");
    await expect(view.locator("p").nth(1)).toHaveText("Zweiter Absatz von Beat");
  }
  // Der eigene Cursor bleibt beim Übernehmen fremder Änderungen an seiner Stelle.
  await page.keyboard.type("!");
  await expect(prose.locator("p").nth(0)).toHaveText("Erster Absatz von Anna!");
  await expect(otherProse.locator("p").nth(0)).toHaveText("Erster Absatz von Anna!");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await other.getByRole("button", { name: "Zurück zur Ablage" }).click();
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
  await other.context().close();
});

test("Gleichzeitiges Bearbeiten in der Präsentation", async ({ page, browser }) => {
  await login(page, ADMIN);
  const expected = [/^409 PUT \/api\/cloud\/files\//];
  const errors = watchErrors(page, expected);
  const other = await (await browser.newContext({ locale: "de-CH", timezoneId: "Europe/Zurich" })).newPage();
  await other.setViewportSize({ width: 1440, height: 950 });
  await login(other, ADMIN);
  const otherErrors = watchErrors(other, expected);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Präsentation/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neue Präsentation (PowerPoint)" });
  await gallery.getByLabel("Name").fill(`Gemeinsam ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  await expect(page.locator(".deck-stage")).toBeVisible();
  await page.getByRole("button", { name: "Folie", exact: true }).click();
  await expect(page.locator(".office-status")).toContainText("Gespeichert um");
  await other.goto("/c/carecore-one/ablage");
  await other.getByText(`Gemeinsam ${stamp}.pptx`, { exact: true }).dblclick();
  await expect(other.locator(".deck-thumb")).toHaveCount(2);

  // Wer auf welcher Folie ist, zeigt die Folienleiste.
  await expect(other.locator(".deck-thumb").nth(1).locator(".deck-thumb-person")).toHaveCount(1);
  // Gleichzeitig: Titel der ersten Folie im einen, Notizen der zweiten Folie im anderen Fenster.
  await other.locator(".deck-thumb-button").nth(0).click();
  await other.getByLabel("Titel der Präsentation").fill(`Teamtag ${stamp}`);
  await page.getByLabel("Notizen für die Vortragenden").fill("Pause um zehn Uhr");
  await expect(page.locator(".deck-thumb").nth(0)).toContainText(`Teamtag ${stamp}`);
  await other.locator(".deck-thumb-button").nth(1).click();
  await expect(other.getByLabel("Notizen für die Vortragenden")).toHaveValue("Pause um zehn Uhr");
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await other.getByRole("button", { name: "Zurück zur Ablage" }).click();
  expect(errors).toEqual([]);
  expect(otherErrors).toEqual([]);
  await other.context().close();
});

// Änderungen nachverfolgen wie in Word: Eingefügtes unterstrichen, Gelöschtes durchgestrichen, mit Name; annehmen
// und ablehnen einzeln oder alle; die Einstellung und die Änderungen bleiben in der Datei erhalten.
test("Dokument: Änderungen nachverfolgen, annehmen und ablehnen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Dokument/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neues Dokument (Word)" });
  await gallery.getByLabel("Name").fill(`Änderungen ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const editor = page.locator(".office-prose");
  await editor.click();
  await page.keyboard.type("Dosis 5 mg täglich.");
  const inserted = editor.locator("ins.office-ins");
  const deleted = editor.locator("del.office-del");
  await expect(inserted).toHaveCount(0);

  const toggle = page.getByRole("button", { name: "Änderungen nachverfolgen" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  // „5“ markieren und überschreiben.
  await editor.click();
  await page.keyboard.press("Home");
  for (let step = 0; step < 6; step += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.type("2,5");
  await expect(deleted).toHaveText("5");
  await expect(inserted).toHaveText("2,5");
  await expect(inserted).toHaveAttribute("data-tip", /^Eingefügt: .+/);
  await expect(editor.locator("p").first()).toHaveText("Dosis 52,5 mg täglich.");
  // Rücktaste am Ende: der Punkt bleibt durchgestrichen stehen und der Cursor davor (wie in Word);
  // eigene neue Eingaben verschwinden beim Löschen ganz.
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await expect(deleted.nth(1)).toHaveText(".");
  await page.keyboard.type("!x");
  await page.keyboard.press("Backspace");
  await expect(editor.locator("p").first()).toHaveText("Dosis 52,5 mg täglich!.");
  await expect(inserted.nth(1)).toHaveText("!");
  await expect(page.locator(".office-status")).toContainText("Gespeichert um");

  // Nach Schliessen und erneutem Öffnen ist alles noch da.
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Änderungen ${stamp}.docx`, { exact: true }).dblclick();
  await expect(editor.locator("p").first()).toHaveText("Dosis 52,5 mg täglich!.");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(deleted).toHaveCount(2);
  await expect(inserted).toHaveCount(2);

  // Von Änderung zu Änderung springen und die vierte (gelöschter Punkt) ablehnen: der Punkt bleibt.
  await editor.click();
  await page.keyboard.press("Home");
  const next = page.getByRole("button", { name: "Nächste Änderung" });
  for (let step = 0; step < 4; step += 1) await next.click();
  await page.getByRole("button", { name: "Ablehnen" }).click();
  await page.getByRole("menuitemradio", { name: "Diese Änderung ablehnen" }).click();
  await expect(deleted).toHaveCount(1);
  await expect(inserted).toHaveCount(2);
  // Alle übrigen annehmen.
  await page.getByRole("button", { name: "Annehmen" }).click();
  await page.getByRole("menuitemradio", { name: "Alle Änderungen annehmen" }).click();
  await expect(editor.locator("p").first()).toHaveText("Dosis 2,5 mg täglich!.");
  await expect(inserted).toHaveCount(0);
  await expect(deleted).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Annehmen" })).toBeDisabled();

  // Ausschalten mit Ctrl+Shift+E: danach wird nicht mehr nachverfolgt.
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+Shift+E");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.type(" Ende");
  await expect(inserted).toHaveCount(0);
  await expect(page.locator(".office-status")).toContainText("Gespeichert um");
  expect(errors).toEqual([]);
});

// Tabelle: Pivot-Tabelle aus einem Bereich mit Überschriften (eigenes Blatt, nur über „Aktualisieren“ geändert) und
// Blattschutz mit einer freigegebenen Zelle.
test("Tabelle: Pivot-Tabelle einfügen und aktualisieren, Blattschutz mit freigegebener Zelle", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Tabelle/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neue Tabelle (Excel)" });
  await gallery.getByLabel("Name").fill(`Auswertung ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const data = page.getByRole("grid", { name: "Blatt Tabelle1" });
  await data.focus();
  for (const row of [
    ["Wohnbereich", "Monat", "Minuten"],
    ["Ahorn", "Januar", "120"],
    ["Birke", "Januar", "90"],
    ["Ahorn", "Februar", "60"],
  ]) {
    for (const [index, value] of row.entries()) {
      await page.keyboard.type(value);
      await page.keyboard.press(index === row.length - 1 ? "Enter" : "Tab");
    }
  }
  await data
    .locator("td")
    .filter({ hasText: /^Wohnbereich$/ })
    .click();

  // Pivot-Tabelle: Summe der Minuten je Wohnbereich.
  await page.getByRole("button", { name: "Pivot-Tabelle einfügen" }).click();
  const dialog = page.getByRole("dialog", { name: "Pivot-Tabelle einfügen" });
  await expect(dialog.getByLabel("Bereich")).toHaveValue("A1:C4");
  await dialog.getByRole("combobox", { name: "Werte" }).click();
  await page.getByRole("option", { name: "Minuten" }).click();
  await dialog.getByRole("button", { name: "Einfügen" }).click();
  const pivot = page.getByRole("grid", { name: "Blatt Pivot-Tabelle 1" });
  await expect(pivot).toBeVisible();
  await expect(pivot.locator("td").filter({ hasText: /^Summe von Minuten$/ })).toHaveCount(1);
  await expect(pivot.locator("td").filter({ hasText: /^Gesamtergebnis$/ })).toHaveCount(1);
  await expect(pivot.locator("td").filter({ hasText: /^270$/ })).toHaveCount(1);
  // Zellen der Pivot-Tabelle sind fest.
  await pivot.locator("td").filter({ hasText: /^180$/ }).click();
  await page.keyboard.type("5");
  await expect(page.locator(".office-toast")).toContainText("Pivot-Tabelle ändert sich nur");
  await expect(pivot.locator("td").filter({ hasText: /^180$/ })).toHaveCount(1);

  // Daten ändern, dann aktualisieren.
  await page.getByRole("tab", { name: "Tabelle1" }).click();
  await data.locator("td").filter({ hasText: /^90$/ }).click();
  await page.keyboard.type("100");
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "Pivot-Tabelle 1" }).click();
  await expect(pivot.locator("td").filter({ hasText: /^270$/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Pivot-Tabelle aktualisieren" }).click();
  await expect(pivot.locator("td").filter({ hasText: /^280$/ })).toHaveCount(1);

  // Blattschutz: C2 bleibt bearbeitbar, A1 nicht.
  await page.getByRole("tab", { name: "Tabelle1" }).click();
  await data.locator("td").filter({ hasText: /^120$/ }).click();
  await page.getByRole("button", { name: "Bearbeitbar trotz Blattschutz" }).click();
  await page.getByRole("button", { name: "Blatt schützen" }).click();
  await expect(page.getByRole("button", { name: "Blattschutz aufheben" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("tab", { name: "Tabelle1" }).locator(".sheet-tab-lock")).toBeVisible();
  await data
    .locator("td")
    .filter({ hasText: /^Wohnbereich$/ })
    .click();
  await page.keyboard.type("X");
  await expect(page.locator(".office-toast")).toContainText("Das Blatt ist geschützt.");
  await expect(data.locator("td").filter({ hasText: /^Wohnbereich$/ })).toHaveCount(1);
  await data.locator("td").filter({ hasText: /^120$/ }).click();
  await page.keyboard.type("125");
  await page.keyboard.press("Enter");
  await expect(data.locator("td").filter({ hasText: /^125$/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Blattschutz aufheben" }).click();
  await data
    .locator("td")
    .filter({ hasText: /^Wohnbereich$/ })
    .click();
  await page.keyboard.type("Bereich");
  await page.keyboard.press("Enter");
  await expect(data.locator("td").filter({ hasText: /^Bereich$/ })).toHaveCount(1);
  await expect(page.locator(".office-status")).toContainText("Gespeichert um");
  expect(errors).toEqual([]);
});

// Präsentation: Übergang je Folie mit Tempo, für alle Folien übernehmen, gespeichert und in der Vorführung abgespielt.
test("Präsentation: Folienübergänge festlegen und in der Vorführung abspielen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  await page.goto("/c/carecore-one/ablage");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: /Präsentation/ }).click();
  const gallery = page.getByRole("dialog", { name: "Neue Präsentation (PowerPoint)" });
  await gallery.getByRole("radio", { name: /Teamsitzung/ }).click();
  await gallery.getByLabel("Name").fill(`Übergänge ${stamp}`);
  await gallery.getByRole("button", { name: "Erstellen und öffnen" }).click();
  const thumbs = page.locator(".deck-thumb");
  await expect(thumbs).toHaveCount(5);

  // Zweite Folie: Schieben, langsam.
  await thumbs.nth(1).locator(".deck-thumb-button").click();
  await expect(page.getByRole("button", { name: "Vorschau des Übergangs" })).toBeDisabled();
  await page.getByRole("button", { name: "Übergang", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Schieben" }).click();
  await expect(thumbs.nth(1).getByRole("img", { name: "Übergang: Schieben" })).toBeVisible();
  await expect(thumbs.nth(0).locator(".deck-thumb-transition")).toHaveCount(0);
  await page.getByRole("button", { name: "Tempo des Übergangs" }).click();
  await page.getByRole("menuitemradio", { name: /Langsam/ }).click();
  await expect(page.getByRole("button", { name: "Tempo des Übergangs" })).toContainText("Langsam");
  await page.getByRole("button", { name: "Vorschau des Übergangs" }).click();

  // Für alle Folien übernehmen, dann die erste Folie ohne Übergang.
  await page.getByRole("button", { name: "Übergang für alle Folien übernehmen" }).click();
  await expect(page.locator(".deck-thumb-transition")).toHaveCount(5);
  await thumbs.nth(0).locator(".deck-thumb-button").click();
  await page.getByRole("button", { name: "Übergang", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Kein Übergang" }).click();
  await expect(page.locator(".deck-thumb-transition")).toHaveCount(4);
  await expect(page.locator(".office-status")).toContainText("Gespeichert um");

  // Nach dem erneuten Öffnen noch da.
  await page.getByRole("button", { name: "Zurück zur Ablage" }).click();
  await page.getByText(`Übergänge ${stamp}.pptx`, { exact: true }).dblclick();
  await expect(page.locator(".deck-thumb-transition")).toHaveCount(4);
  await expect(thumbs.nth(2).getByRole("img", { name: "Übergang: Schieben" })).toBeVisible();

  // Vorführung: beim Weiterschalten liegen kurz beide Folien übereinander, danach nur noch die neue.
  await page.getByRole("button", { name: "Ab aktueller Folie vorführen" }).click();
  const presenter = page.getByRole("dialog", { name: "Vorführen" });
  await expect(presenter.locator(".deck-presenter-layer")).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await expect(presenter.locator(".deck-presenter-layer")).toHaveCount(2);
  await expect(presenter.locator(".deck-presenter-layer")).toHaveCount(1);
  await expect(presenter).toContainText("2 / 5");
  await page.keyboard.press("Escape");
  await expect(presenter).toHaveCount(0);
  expect(errors).toEqual([]);
});
