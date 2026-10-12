import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Universelle Aktionen: dieselben Aktionen wie die Schnellaktionen, auch aus der Suche (⌘K) – mit Person im Suchbegriff.
async function firstResident(page: import("@playwright/test").Page) {
  const { residents } = (await (await page.request.get("/api/medication/residents")).json()) as {
    residents: Array<{ id: string; name: string }>;
  };
  return residents[0];
}

test("Suche: „vital <Name>“ öffnet die Vitalwerterfassung für diese Person", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const resident = await firstResident(page);
  const lastName = resident.name.split(" ").at(-1)!;
  await page.goto("/c");
  await page.getByRole("button", { name: "Globale Suche öffnen" }).click();
  await page.getByLabel("Suchbegriff").fill(`vital ${lastName}`);
  const result = page.locator(".search-result", { hasText: `Vitalwerte erfassen · ${resident.name}` });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/c\/vitalwerte/);
  const dialog = page.getByRole("dialog", { name: "Vitalwerte erfassen" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(resident.name);
  // Später erneut besucht öffnet sich die Seite ohne Dialog.
  await dialog.getByRole("button", { name: "Fenster schliessen" }).click();
  await page.goto("/c");
  await page.goto("/c/vitalwerte");
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Vitalwerte erfassen" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Suche: Übergabepunkt für die Person aus der Kopfzeile – vorgewählt, Cursor im Textfeld", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const resident = await firstResident(page);
  await page.addInitScript((id) => window.sessionStorage.setItem("carecore.residentId", id), resident.id);
  await page.goto("/c");
  await page.getByRole("button", { name: "Globale Suche öffnen" }).click();
  await page.getByLabel("Suchbegriff").fill("übergabe");
  const result = page.locator(".search-result", { hasText: "Übergabepunkt erfassen" });
  await expect(result).toContainText(`für ${resident.name}`);
  await result.click();
  const field = page.getByLabel("Übergabepunkt", { exact: true });
  await expect(field).toBeFocused();
  await expect(page.locator(".handover-editor")).toContainText(resident.name);
  expect(errors).toEqual([]);
});

test.describe("Handy-Ansicht (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Schnellaktion Vitalwerte öffnet die Erfassung direkt", async ({ page }) => {
    await login(page, ADMIN);
    const errors = watchErrors(page);
    const resident = await firstResident(page);
    await page.addInitScript((id) => window.sessionStorage.setItem("carecore.residentId", id), resident.id);
    await page.goto("/c/medikation/reserven");
    await expect(page.locator("h1").first()).toBeVisible();
    await page.getByRole("button", { name: "Schnellaktionen" }).tap();
    await page.getByRole("dialog", { name: "Schnellaktionen" }).getByRole("button", { name: "Vitalwerte" }).tap();
    await expect(page).toHaveURL(/\/c\/vitalwerte/);
    const dialog = page.getByRole("dialog", { name: "Vitalwerte erfassen" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(resident.name);
    expect(errors).toEqual([]);
  });
});
