import { expect, test } from "@playwright/test";
import { ADMIN, field, login, watchErrors } from "./support";

// Portal: die Administration legt einen Zugang an und gibt einzelne Bereiche einer Person frei; die Angehörige
// meldet sich unter /portal an, ändert das Einmal-Passwort und sieht nur das Freigegebene. Zugriffe sind sichtbar.
test("Portal: Zugang anlegen, Bereiche freigeben, im Portal anmelden und nur Freigegebenes sehen", async ({
  page,
  browser,
}) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const { residents } = (await (await page.request.get("/api/medication/residents")).json()) as {
    residents: Array<{ id: string; name: string }>;
  };
  const target = residents[0];
  const stamp = Date.now().toString(36);
  const username = `angehoerige-${stamp}`;
  const name = `Petra Klicktest ${stamp}`;

  await page.goto("/c/leitung/administration/portal");
  await page.getByRole("button", { name: "Zugang anlegen" }).click();
  await field(page, "Name").fill(name);
  await field(page, "Benutzername").fill(username);
  await page.locator(".editor-dialog").getByRole("button", { name: "Anlegen" }).click();
  const oneTime = await page.locator(".editor-dialog").getByLabel("Einmal-Passwort").inputValue();
  expect(oneTime).toMatch(/^[\w]{4}(-[\w]{4})+$/);
  await page.locator(".editor-dialog").getByRole("button", { name: "Fertig" }).click();

  const detail = page.locator(".portal-account-detail");
  await expect(detail).toContainText(name);
  await detail.getByRole("button", { name: "Freigabe erteilen" }).click();
  const dialog = page.locator(".editor-dialog");
  await dialog.locator(".care-select-trigger, [role=combobox]").first().click();
  await page.getByRole("option", { name: target.name }).click();
  await dialog.getByLabel("Medikation (laufende Verordnungen)").check();
  await dialog.getByLabel("Notfalldaten (Reanimationsstatus, Allergien)").check();
  await dialog.getByLabel("Einwilligung der Person").check();
  await field(page, "Vermerk zur Grundlage").fill("schriftlich, Klicktest");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(detail.locator(".admin-retention-row", { hasText: target.name })).toContainText("Medikation");

  // Portal in eigenem Browserkontext (ohne Sitzung der Pflege-App).
  const portalContext = await browser.newContext();
  const portal = await portalContext.newPage();
  const portalErrors = watchErrors(portal, [/^401 GET \/api\/portal\/me$/, /^401 POST \/api\/portal\/auth\/login$/]);
  await portal.goto("/portal");
  await portal.getByLabel("Benutzername").fill(username);
  await portal.getByLabel("Passwort", { exact: true }).fill("falsch");
  await portal.getByRole("button", { name: "Anmelden" }).click();
  await expect(portal.locator(".portal-error")).toContainText("nicht korrekt");
  await portal.getByLabel("Passwort", { exact: true }).fill(oneTime);
  await portal.getByRole("button", { name: "Anmelden" }).click();
  await expect(portal.getByRole("heading", { name: "Bitte ein eigenes Passwort festlegen" })).toBeVisible();
  // Vor dem Passwortwechsel keine Daten.
  expect((await portal.request.get(`/api/portal/residents/${target.id}`)).status()).toBe(403);
  await portal.getByLabel("Einmal-Passwort").fill(oneTime);
  await portal.getByLabel("Neues Passwort", { exact: true }).fill("Portal-Passwort-2026");
  await portal.getByLabel("Neues Passwort wiederholen").fill("Portal-Passwort-2026");
  await portal.getByRole("button", { name: "Passwort speichern" }).click();
  await expect(portal.getByRole("heading", { name: target.name })).toBeVisible();
  await expect(portal.getByRole("heading", { name: "Medikation" })).toBeVisible();
  await expect(portal.getByRole("heading", { name: "Notfalldaten" })).toBeVisible();
  await expect(portal.getByRole("heading", { name: /Vitalwerte/ })).toHaveCount(0);
  await expect(portal.getByRole("heading", { name: /Pflegeberichte/ })).toHaveCount(0);
  // Keine Schnittstelle der Pflege-App mit der Portal-Sitzung.
  expect((await portal.request.get("/api/medication/residents")).status()).toBe(401);
  expect(portalErrors).toEqual([]);

  // Zugriff im Protokoll, Widerruf wirkt sofort.
  await page.reload();
  await page.locator(".portal-account-row", { hasText: name }).click();
  await expect(detail.locator(".portal-access-log")).toContainText(`Daten angesehen · ${target.name}`);
  await detail
    .locator(".admin-retention-row", { hasText: target.name })
    .getByRole("button", { name: "Widerrufen" })
    .click();
  await page.locator(".editor-dialog").getByRole("button", { name: "Widerrufen" }).click();
  await expect(detail).toContainText("widerrufen");
  await portal.reload();
  await expect(portal.getByRole("heading", { name: "Keine Freigabe" })).toBeVisible();
  await portalContext.close();
  expect(errors).toEqual([]);
});
