import { expect, test } from "@playwright/test";
import { ADMIN, SRK, login, watchErrors } from "./support";

// Administration beendet alle Sitzungen einer Person: deren angemeldeter Browser ist danach abgemeldet.
test("Sitzungen beenden: Person ist überall abgemeldet", async ({ page, browser }) => {
  const other = await browser.newPage();
  await login(other, SRK);
  expect((await other.request.get("/api/work-context")).status()).toBe(200);

  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/leitung/administration/benutzer");
  await page.locator(".admin-user-row", { hasText: "Carla Frey" }).first().click();
  await page.getByRole("button", { name: "Alle Sitzungen beenden" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Sitzung/ })).toContainText(/beendet|keine Sitzung/);
  expect((await other.request.get("/api/work-context")).status()).toBe(401);
  await other.close();
  expect(errors).toEqual([]);
});

// Such-Assistenz: Frage in der Suche ⌘K geht an CareOS KI (ohne Schlüssel kommt eine klare Meldung).
test("Such-Assistenz: Frage in der Suche an CareOS KI stellen", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/c");
  const dialog = page.getByRole("dialog", { name: "Globale Suche" });
  // Das Tastenkürzel wirkt erst, wenn die Seite geladen ist; Öffnen ist wiederholbar.
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  await dialog.getByLabel("Suchbegriff").fill("Wer ist diese Woche gestürzt?");
  const ask = dialog.getByRole("button", { name: /CareOS KI fragen/ });
  await expect(ask).toBeVisible();
  await ask.click();
  await expect(dialog.locator(".search-ai-answer")).toContainText(/MISTRAL_API_KEY|Antwort|gestürzt/);
});
