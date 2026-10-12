import { expect, test } from "@playwright/test";
import { ADMIN, FAGE, login, watchErrors } from "./support";

// Sprachen: die Administration übersetzt und prüft einen Text, gibt Englisch frei; eine Mitarbeiterin wählt Englisch
// und sieht den geprüften Text, Ungeprüftes bleibt Deutsch. Erfasste Inhalte werden nie übersetzt.
test("Sprachen: Text prüfen, Sprache freigeben, als Mitarbeiterin Englisch wählen", async ({ page, browser }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/leitung/administration/sprachen");
  const languages = page.locator(".admin-retention-row", { hasText: "English" });
  await languages.getByRole("button", { name: "Prüfen" }).click();
  await page.getByLabel("Text suchen").fill("Mein Dienst");
  const entry = page
    .locator(".languages-entry")
    .filter({ has: page.locator("strong", { hasText: /^\s*Mein Dienst\s*$/ }) });
  await entry.click();
  const dialog = page.locator(".editor-dialog");
  await dialog.locator("textarea").fill("My shift");
  await dialog.getByRole("button", { name: "Speichern und als geprüft markieren" }).click();
  await expect(entry).toContainText("Geprüft");
  // Ein Entwurf (ungeprüft) für einen anderen Text: erscheint bei Mitarbeitenden nicht.
  await page.getByLabel("Text suchen").fill("Medikation");
  const draft = page
    .locator(".languages-entry")
    .filter({ has: page.locator("strong", { hasText: /^\s*Medikation\s*$/ }) });
  await draft.click();
  await dialog.locator("textarea").fill("Medication");
  await dialog.getByRole("button", { name: "Als Entwurf speichern" }).click();
  await expect(draft).toContainText("Entwurf");
  await languages.getByRole("button", { name: "Freigeben" }).click();
  await expect(languages).toContainText("freigegeben");

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const staffErrors = watchErrors(staff);
  await login(staff, FAGE);
  await staff.goto("/c/einstellungen/appearance");
  await staff.locator(".settings-list button", { hasText: "Sprache der Oberfläche" }).click();
  await staff.locator(".settings-detail").getByRole("combobox", { name: "Sprache" }).click();
  await staff.getByRole("option", { name: "English" }).click();
  await expect(staff.locator("html")).toHaveAttribute("lang", "en");
  // Seitenleiste: Beschriftung der Knöpfe (aria-label) übersetzt; der ungeprüfte Entwurf bleibt Deutsch.
  const sidebar = staff.getByRole("complementary", { name: "Hauptnavigation" });
  await expect(sidebar.getByRole("button", { name: "My shift" }).first()).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Mein Dienst", exact: true })).toHaveCount(0);
  // Bleibt nach dem Neuladen.
  await staff.reload();
  await expect(staff.locator("html")).toHaveAttribute("lang", "en");
  await expect(sidebar.getByRole("button", { name: "My shift" }).first()).toBeVisible();
  await staff.goto("/c/medikation");
  await expect(staff.getByRole("heading", { name: "Medikamentenplan" })).toBeVisible();
  expect(await staff.locator("body").innerText()).not.toContain("Medication");

  // Aufräumen: zurück auf Deutsch, Freigabe zurückziehen.
  expect((await staff.request.patch("/api/me/settings", { data: { language: "de" } })).ok()).toBe(true);
  await staff.evaluate(() => localStorage.removeItem("carecore-language"));
  await staffContext.close();
  await languages.getByRole("button", { name: "Freigabe zurückziehen" }).click();
  await expect(languages).toContainText("nicht freigegeben");
  expect(staffErrors).toEqual([]);
  expect(errors).toEqual([]);
});
