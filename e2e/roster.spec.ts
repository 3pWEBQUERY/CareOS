import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, FAGE, login, watchErrors } from "./support";

// Läuft der Reihe nach auf den Demodaten (database/seed-roster.ts, Wohngruppe Ahorn).
test.describe.configure({ mode: "serial" });
const LEAD = { username: "demo.leitung.ahorn", password: DEMO_PASSWORD };

test("Dienstplan: Kürzel ins Raster tippen und den Monat mit Begründung veröffentlichen", async ({ page }) => {
  await login(page, LEAD);
  const errors = watchErrors(page);
  await page.goto("/c/dienstplan");
  const firstCell = page.locator("[role=gridcell]").first();
  const before = await firstCell.getAttribute("aria-label");
  await page.getByRole("button", { name: "Nächster Monat" }).click();
  await expect(firstCell).not.toHaveAttribute("aria-label", before!);
  // In den letzten zwei Wochen des Monats ist der Folgemonat schon veröffentlicht (Demodaten); dann der übernächste.
  const state = page.getByRole("button", { name: /^Veröffentlich(t|en)$/ });
  await expect(state).toBeVisible();
  if (await page.getByRole("button", { name: "Veröffentlicht", exact: true }).count()) {
    const shown = await firstCell.getAttribute("aria-label");
    await page.getByRole("button", { name: "Nächster Monat" }).click();
    await expect(firstCell).not.toHaveAttribute("aria-label", shown!);
  }
  const free = page.locator('[role=gridcell][aria-label^="Carla Frey"][aria-label$=", frei"]').nth(5);
  const label = (await free.getAttribute("aria-label"))!;
  const day = label.replace(/^Carla Frey, /, "").replace(/, frei$/, "");
  await free.click();
  await free.press("f");
  await page.keyboard.press("Enter");
  const cell = page.locator(`[role=gridcell][aria-label^="Carla Frey, ${day}"]`);
  await expect(cell).toContainText("F");
  await expect(cell).not.toHaveAttribute("aria-label", /, frei$/);

  // Veröffentlichen: Warnungen der Regelprüfung verlangen eine Begründung.
  await page.getByRole("button", { name: "Veröffentlichen", exact: true }).click();
  const panel = page.locator("[role=dialog]", { hasText: "veröffentlichen" });
  await expect(panel).toContainText("0 Blocker");
  await panel.locator(".roster-reason textarea").fill("Unterbesetzung mit Springerpool abgesprochen");
  await panel.getByRole("button", { name: "Veröffentlichen", exact: true }).click();
  await expect(page.locator("[role=dialog]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Veröffentlicht", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Diensttausch: Kollegin nimmt an; ein Tausch gegen die Ruhezeit lässt sich nicht genehmigen", async ({ page }) => {
  // Lena Bucher (FaGe) nimmt die Anfrage von Sina Moser an; das Regelwerk der Demo führt ihn ohne Genehmigung aus.
  await login(page, FAGE);
  // Der abgelehnte Genehmigungsversuch (409) ist erwartet.
  const errors = watchErrors(page, [/^409 POST \/api\/dienstplan\/swaps\//]);
  await page.goto("/c/mein-dienstplan/antraege");
  const incoming = page
    .locator("tr", { hasText: "Sina Moser" })
    .filter({ has: page.getByRole("button", { name: "Annehmen" }) });
  const accepted = page.waitForResponse(
    (response) => /\/api\/dienstplan\/swaps\//.test(response.url()) && response.request().method() !== "GET",
  );
  await incoming.getByRole("button", { name: "Annehmen" }).click();
  expect((await accepted).status()).toBe(200);
  await expect(page.locator("tr", { hasText: "Sina Moser" }).filter({ hasText: "Spätdienst" }).first()).toContainText(
    "Getauscht",
  );

  // Die offene Anfrage von David Hug verletzt die Ruhezeit von Julia Roth: Beim Genehmigen wird erneut geprüft,
  // der Blocker lässt sich nicht übersteuern und der Tausch gilt als fehlgeschlagen (mit Grund).
  await page.context().clearCookies();
  await login(page, LEAD);
  await page.goto("/c/dienstplan/antraege");
  await expect(page.locator("tr", { hasText: "Sina Moser" }).filter({ hasText: "Spätdienst" }).first()).toContainText(
    "Getauscht",
  );
  const swap = page.locator("tr", { hasText: "David Hug" }).filter({ hasText: "Julia Roth" });
  await expect(swap).toContainText("Wartet auf Genehmigung");
  await swap.getByRole("button", { name: "Genehmigen" }).click();
  const dialog = page.locator("[role=dialog]");
  await dialog.getByRole("button", { name: "Genehmigen und ausführen" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/liegen nur .* statt 11:00 h/);
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(swap).toContainText("Fehlgeschlagen");
  await expect(swap).toContainText(/statt 11:00 h/);
  await expect(swap.getByRole("button", { name: "Genehmigen" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Offene Dienste: Interesse melden, Leitung sieht es und lehnt mit Kommentar ab", async ({ page }) => {
  await login(page, FAGE);
  let errors = watchErrors(page);
  await page.goto("/c/mein-dienstplan/antraege");
  const card = page.getByRole("region", { name: "Offene Dienste" });
  await expect(card.getByRole("heading", { name: "Offene Dienste" })).toBeVisible();
  const showAll = card.getByRole("button", { name: /^Alle \d+ anzeigen$/ });
  if (await showAll.count()) await showAll.click();
  const row = card
    .locator("tr")
    .filter({ has: page.getByRole("button", { name: "Interesse melden" }) })
    .first();
  const date = (await row.locator("td").first().innerText()).trim();
  const service = (await row.locator("td").nth(1).innerText()).trim();
  await row.getByRole("button", { name: "Interesse melden" }).click();
  await expect(page.locator(".toast")).toContainText("Interesse gemeldet");
  const mine = card.locator("tr", { hasText: date }).filter({ hasText: service });
  await expect(mine).toContainText("Interesse gemeldet");
  expect(errors).toEqual([]);

  await page.context().clearCookies();
  await login(page, LEAD);
  errors = watchErrors(page);
  await page.goto("/c/dienstplan/antraege");
  const lead = page.getByRole("region", { name: "Offene Dienste" });
  const slot = lead.locator("tr", { hasText: date }).filter({ hasText: service });
  const interest = slot.locator("li", { hasText: "Lena Bucher" });
  await interest.getByRole("button", { name: "Ablehnen" }).click();
  const dialog = page.locator("[role=dialog]");
  await dialog.locator("textarea").fill("Bereits genug Stunden diese Woche");
  await dialog.getByRole("button", { name: "Ablehnen", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Interesse abgelehnt");
  await expect(slot.locator("li", { hasText: "Lena Bucher" })).toHaveCount(0);
  expect(errors).toEqual([]);

  await page.context().clearCookies();
  await login(page, FAGE);
  await page.goto("/c/mein-dienstplan/antraege");
  await expect(page.getByRole("region", { name: "Offene Dienste" }).locator(".roster-open-history")).toContainText(
    "Nicht zugeteilt",
  );
});
