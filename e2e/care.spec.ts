import { expect, test } from "@playwright/test";
import { ADMIN, field, login, pickDate, watchErrors } from "./support";

// Wunden, Pflegeplanung und Kompass auf den Demodaten, der Reihe nach.
test.describe.configure({ mode: "serial" });

test("Wunde anlegen mit Erstbeurteilung und Verlauf dokumentieren", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/wundmanagement");
  await page.getByRole("button", { name: "Neue Wunde erfassen" }).click();
  const dialog = page.locator(".editor-dialog");
  await dialog.getByRole("combobox", { name: "Bewohner" }).click();
  const residentOption = page.getByRole("listbox", { name: "Bewohner" }).getByRole("option").first();
  const residentName = (await residentOption.innerText()).split(" · ")[0].trim();
  await residentOption.click();
  await dialog.getByRole("combobox", { name: "Wundart" }).click();
  await page.getByRole("option", { name: "Ulcus cruris" }).click();
  await field(page, "Lokalisation").fill("Unterschenkel rechts, medial");
  await dialog.getByLabel("Länge in cm").fill("3,2");
  await dialog.getByLabel("Breite in cm").fill("2");
  await field(page, "Durchgeführte Versorgung").fill("Reinigung NaCl 0,9 %, Schaumverband");
  await dialog.getByRole("button", { name: "Wunde erfassen" }).click();
  await expect(dialog).toHaveCount(0);

  const row = page
    .locator("button, article, tr", { hasText: residentName })
    .filter({ hasText: "Unterschenkel rechts" })
    .first();
  await row.click();
  await expect(page.getByText("3,2 × 2 cm").first()).toBeVisible();
  await page.getByRole("button", { name: "Verlauf dokumentieren" }).click();
  await dialog.getByLabel("Länge in cm").fill("2,8");
  await dialog.getByLabel("Breite in cm").fill("1,6");
  await field(page, "Bemerkung").fill("Wundrand rosig, weniger Exsudat");
  await dialog.getByRole("button", { name: "Eintrag speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Wundrand rosig, weniger Exsudat")).toBeVisible();
  await expect(page.getByText("2 Einträge")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Überfällige Wundversorgung: direkt aus dem Hinweis dokumentieren, danach ist sie erledigt", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  // Wunde mit täglichem Verbandwechsel, festgestellt vor vier Tagen, noch ohne Verlaufseintrag: überfällig.
  const payload = await (await page.request.get("/api/wounds")).json();
  const resident = payload.residents[payload.residents.length - 1];
  const discoveredOn = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
  const created = await page.request.post("/api/wounds", {
    data: {
      residentId: resident.id,
      woundType: "Skin Tear",
      bodyLocation: "Linker Handrücken",
      discoveredOn,
      careIntervalDays: 1,
      origin: "inhouse",
    },
  });
  expect(created.status(), await created.text()).toBe(201);

  await page.goto("/c/wundmanagement");
  const alert = page.locator(".wound-alert");
  const item = alert.locator("li", { hasText: `${resident.name} · Linker Handrücken` });
  await expect(item).toContainText(/Überfällig seit \d+ Tag/);
  await item.getByRole("button", { name: "Versorgung dokumentieren" }).click();
  const dialog = page.locator(".editor-dialog");
  await field(page, "Durchgeführte Versorgung").fill("Steri-Strips erneuert, Wundrand reizlos");
  await dialog.getByRole("button", { name: "Eintrag speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".wound-alert li", { hasText: "Linker Handrücken" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Wundversorgung: Verbandsmaterial aus dem Katalog dokumentieren", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const productName = `E2E Schaumverband ${Date.now()}`;
  const product = await page.request.post("/api/care-supply-products", {
    data: { itemName: productName, category: "Wundversorgung", unit: "Stück" },
  });
  expect(product.status(), await product.text()).toBe(201);
  const payload = await (await page.request.get("/api/wounds")).json();
  const resident = payload.residents[payload.residents.length - 1];
  const created = await page.request.post("/api/wounds", {
    data: {
      residentId: resident.id,
      woundType: "Skin Tear",
      bodyLocation: "Rechter Unterarm",
      discoveredOn: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
      careIntervalDays: 1,
      origin: "inhouse",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const woundId = ((await created.json()) as { id: string }).id;

  await page.goto("/c/wundmanagement");
  const item = page.locator(".wound-alert li", { hasText: `${resident.name} · Rechter Unterarm` });
  await item.getByRole("button", { name: "Versorgung dokumentieren" }).click();
  const dialog = page.locator(".editor-dialog");
  await dialog.getByRole("combobox", { name: "Material" }).click();
  await page.getByRole("option", { name: `${productName} (Stück)` }).click();
  await dialog.getByLabel("Menge").fill("2");
  await dialog.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(dialog.locator(".wound-materials li")).toHaveText(new RegExp(`2 Stück ${productName}`));
  await dialog.getByRole("button", { name: "Eintrag speichern" }).click();
  await expect(dialog).toHaveCount(0);

  const entries = (await (await page.request.get(`/api/wounds/${woundId}/entries`)).json()) as {
    entries: Array<{ materials: Array<{ name: string; quantity: number }> }>;
  };
  expect(entries.entries[0].materials).toEqual([expect.objectContaining({ name: productName, quantity: 2 })]);
  expect(errors).toEqual([]);
});

test("Wundübersicht folgt dem Bewohner aus der Kopfzeile – und umgekehrt", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/wundmanagement");
  const header = page.locator(".topbar .resident-context-trigger strong");
  const sidebarName = page.locator(".wound-sidebar .wound-focus-card .card-title");

  // Klick auf eine Wunde wählt auch den Bewohner in der Kopfzeile.
  const row = page.locator(".wound-case-row").first();
  // Nur der Name, ohne die REA-Kennzeichnung daneben.
  const rowName = (
    await row.locator(".wound-case-main strong").evaluate((element) => element.firstChild?.textContent ?? "")
  ).trim();
  await row.click();
  await expect(header).toHaveText(rowName);
  await expect(sidebarName).toHaveText(rowName);

  // Wechsel in der Kopfzeile: rechts steht sofort dieser Bewohner (mit Wunde oder „Keine offene Wunde“).
  for (let step = 0; step < 3; step += 1) {
    const before = (await header.innerText()).trim();
    await page.locator(".topbar").getByRole("button", { name: "Nächster Bewohner" }).click();
    await expect(header).not.toHaveText(before);
    await expect(sidebarName).toHaveText((await header.innerText()).trim());
  }
  expect(errors).toEqual([]);
});

test("Pflegeplan anlegen, Ziel formulieren und evaluieren", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/pflegeplanung");
  await page.getByRole("button", { name: "Pflegeplan anlegen" }).first().click();
  const dialog = page.locator(".editor-dialog");
  await field(page, "Pflegefokus").fill("Mobilität erhalten und Stürze vermeiden");
  await dialog.getByRole("button", { name: "Pflegeplan anlegen" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: "Pflegeziel hinzufügen" }).first().click();
  await field(page, "Pflegeproblem").fill("Gangunsicherheit nach Sturz");
  // Ressourcen als Mehrfachauswahl: zwei aus der Liste, eine eigene Ergänzung.
  await dialog.getByRole("combobox", { name: "Ressourcen" }).click();
  const resources = page.getByRole("listbox", { name: "Ressourcen" });
  await resources.getByRole("option", { name: "Motiviert", exact: true }).click();
  await resources.getByRole("option", { name: "Nutzt Rollator", exact: true }).click();
  await expect(resources.getByRole("option", { name: "Motiviert", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByLabel("Eigene Ressource ergänzen").fill("Gute Kooperation");
  await page.getByRole("button", { name: "Hinzufügen", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("list", { name: "Ressourcen: ausgewählt" }).locator("li")).toHaveCount(3);
  await field(page, /^Ziel$/).fill("Geht mit Rollator 20 m im Korridor ohne Sturz");
  await dialog.getByRole("button", { name: "Ziel hinzufügen" }).click();
  await expect(dialog).toHaveCount(0);
  const goal = page.locator("article", { hasText: "Geht mit Rollator 20 m im Korridor ohne Sturz" }).first();
  await expect(goal).toBeVisible();
  await expect(goal).toContainText("Motiviert, Nutzt Rollator, Gute Kooperation");

  await goal.getByRole("button", { name: "Evaluieren" }).click();
  await field(page, "Begründung").fill("Geht 15 m mit Begleitung, Sicherheit nimmt zu");
  await dialog.getByRole("button", { name: "Evaluation speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Geht 15 m mit Begleitung, Sicherheit nimmt zu").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Kompass: Abklärung beginnen, alle Bereiche beantworten, automatisch speichern und abschliessen", async ({
  page,
}) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/kompass");
  await page.getByRole("button", { name: /Peter Aebischer/ }).click();
  await expect(page.getByRole("heading", { name: "Neue Abklärung · Peter Aebischer" })).toBeVisible();
  // Anlass nur mit der Tastatur: öffnen, eine Option weiter, Enter wählt.
  const occasion = page.getByRole("combobox", { name: "Anlass" });
  await occasion.focus();
  await page.keyboard.press("ArrowDown");
  await expect(occasion).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(occasion).toHaveText("Regelmässige Abklärung");
  await expect(occasion).toBeFocused();
  await page.getByRole("button", { name: "Abklärung beginnen" }).click();
  await expect(page.getByText("Abklärung für Peter Aebischer begonnen")).toBeVisible();
  const steps = page.getByRole("navigation", { name: "Bereiche der Abklärung" });
  await expect(steps.getByRole("button")).toHaveCount(15);

  // Grunddaten: Beteiligte wählen.
  await page.getByRole("group", { name: "Beteiligt" }).getByRole("button", { name: "Person selbst" }).click();
  await page.getByRole("button", { name: /^Weiter: Kommunikation & Sinne/ }).click();

  // Jeden Bereich beantworten: erste Stufe, bei Bewegung „Teilweise Hilfe“ und Handlungsbedarf mit Beschreibung.
  for (let step = 0; step < 13; step += 1) {
    const panel = page.locator(".kompass-panel");
    const title = (await panel.getByRole("heading", { level: 2 }).textContent()) ?? "";
    const items = panel.locator(".kompass-item");
    const count = await items.count();
    for (let index = 0; index < count; index += 1) {
      const choices = items.nth(index).getByRole("radio");
      await (
        title === "Bewegung & Mobilität" && index === 1
          ? items.nth(index).getByRole("radio", { name: "Teilweise Hilfe" })
          : choices.first()
      ).click();
    }
    if (title === "Bewegung & Mobilität") {
      await panel.getByRole("radio", { name: "Handlungsbedarf", exact: true }).click();
      await panel.getByLabel("Was soll die Pflegeplanung aufgreifen? (Pflicht)").fill("Begleitung beim Aufstehen");
      await panel.getByLabel("Ressourcen – was die Person selbst kann und gerne tut").fill("Geht gerne in den Garten");
    } else await panel.getByRole("radio", { name: "Kein Handlungsbedarf" }).click();
    await expect(steps.locator("li[data-complete=true]")).toHaveCount(step + 1);
    if (step === 2) {
      // Nach einem Neuladen ist alles gespeichert.
      await expect(page.locator(".kompass-bar-state small")).toContainText("gespeichert um");
      await page.reload();
      await expect(steps.locator("li[data-complete=true]")).toHaveCount(3);
      await steps
        .getByRole("button", { name: /Sicherheit im Alltag|Körperpflege & Kleiden/ })
        .first()
        .click();
      await steps.getByRole("button", { name: /Körperpflege & Kleiden/ }).click();
      continue;
    }
    await page.getByRole("button", { name: /^Weiter: / }).click();
  }

  await expect(page.getByRole("heading", { name: "Abschluss", level: 2 })).toBeVisible();
  const table = page.locator(".kompass-table");
  await expect(table.getByRole("row", { name: /Bewegung & Mobilität/ })).toContainText("Ja");
  await page
    .getByLabel("Gesamtbild aus Sicht der Fachperson")
    .fill("Selbständig mit Rollator, braucht Hilfe beim Aufstehen.");
  await page.getByRole("button", { name: "Abklärung abschliessen" }).click();
  await expect(page.getByText("Abklärung für Peter Aebischer abgeschlossen")).toBeVisible();
  const history = page.getByRole("region", { name: "Abgeschlossene Abklärungen" });
  await expect(history).toContainText("Handlungsbedarf: Bewegung & Mobilität");

  // Handlungsbedarf als Ziel in die Pflegeplanung übernehmen.
  const needs = page.getByRole("region", { name: "Handlungsbedarf der letzten Abklärung" });
  await expect(needs).toContainText("Begleitung beim Aufstehen");
  await needs.getByRole("button", { name: "Als Ziel übernehmen" }).click();
  const adopt = page.getByRole("dialog", { name: "Als Ziel in die Pflegeplanung" });
  await expect(adopt).toContainText("Mobilität");
  await adopt.getByLabel("Ziel").fill("Steht am Morgen mit Begleitung sicher auf");
  const inFourWeeks = new Date(Date.now() + 28 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
  await pickDate(adopt, "Überprüfung am", inFourWeeks);
  await adopt.getByRole("button", { name: "Ziel übernehmen" }).click();
  await expect(needs.getByRole("link", { name: /Ziel in der Pflegeplanung: Steht am Morgen/ })).toBeVisible();
  await expect(needs.getByRole("button", { name: "Als Ziel übernehmen" })).toHaveCount(0);

  // Bericht mit allen Antworten und dem übernommenen Ziel.
  const reportHref = await needs.getByRole("link", { name: "Bericht" }).getAttribute("href");
  await page.goto(`${reportHref}&dialog=0`);
  await expect(page.getByRole("heading", { name: "Peter Aebischer", level: 1 })).toBeVisible();
  const mobility = page.locator(".kompass-sheet-domain", { hasText: "Bewegung & Mobilität" });
  await expect(mobility.getByRole("row", { name: /Aufstehen und Hinsetzen/ })).toContainText("Teilweise Hilfe");
  await expect(mobility).toContainText("Ziel in der Pflegeplanung: Steht am Morgen mit Begleitung sicher auf");
  await expect(page.locator(".kompass-sheet-domain", { hasText: "Gesamtbild" })).toContainText(
    "Selbständig mit Rollator",
  );
  await page.goto("/c/kompass");
  await expect(page.getByRole("button", { name: /Peter Aebischer.*Zimmer 101/ })).toContainText("Aktuell");

  // Auswertung je Wohnbereich: nur gezählt, je Bereich aufklappbar bis zur einzelnen Frage.
  await page.goto("/c/kompass/berichte");
  const statistics = page.getByRole("region", { name: "Unterstützung je Bereich" });
  await expect(statistics).toContainText("mit abgeschlossener Abklärung");
  const mobilityRow = statistics.getByRole("button", { name: /Bewegung & Mobilität/ });
  await mobilityRow.click();
  await expect(mobilityRow).toHaveAttribute("aria-expanded", "true");
  await expect(statistics.locator(".kompass-statistics-item", { hasText: "Aufstehen und Hinsetzen" })).toContainText(
    "Teilweise Hilfe",
  );

  // Frühere Adressen leiten weiter.
  await page.goto("/c/rai/erfassung");
  await expect(page).toHaveURL(/\/c\/kompass\/abklaerung/);
  expect(errors).toEqual([]);
});
