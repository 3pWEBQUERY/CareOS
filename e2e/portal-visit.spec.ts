import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Visite im Portal: die Pflege markiert eine Frage „Für Visite“, die Administration gibt der Ärztin die Visite frei;
// im Portal erfasst sie die Rückmeldung, die Pflege sieht sie in der Visite mit „(Portal)“.
test("Visite im Portal: Freigabe, offene Frage beantworten, Rückmeldung in der Pflege", async ({ page, browser }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const { residents } = (await (await page.request.get("/api/medication/residents")).json()) as {
    residents: Array<{ id: string; name: string }>;
  };
  const target = residents[0];
  const stamp = Date.now().toString(36);
  const name = `Dr. Klicktest ${stamp}`;
  const username = `aerztin-${stamp}`;
  const question = `Bitte Wundsalbe prüfen ${stamp}`;
  const created = await page.request.post("/api/documentation", {
    data: { residentId: target.id, category: "Beobachtung", body: question, importance: "visit" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const account = await page.request.post("/api/admin/portal", {
    data: { kind: "physician", displayName: name, username },
  });
  expect(account.status(), await account.text()).toBe(201);
  const { password } = (await account.json()) as { password: string };

  await page.goto("/c/leitung/administration/portal");
  await page.locator(".portal-account-row", { hasText: name }).click();
  const detail = page.locator(".portal-account-detail");
  await detail.getByRole("button", { name: "Freigabe erteilen" }).click();
  const dialog = page.locator(".editor-dialog");
  await dialog.locator(".care-select-trigger, [role=combobox]").first().click();
  await page.getByRole("option", { name: target.name }).click();
  await dialog.getByLabel(/^Visite/).check();
  await dialog.getByLabel("Behandlungsverhältnis").check();
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(detail.locator(".admin-retention-row", { hasText: target.name })).toContainText("Visite");

  const portalContext = await browser.newContext();
  const portal = await portalContext.newPage();
  const portalErrors = watchErrors(portal, [/^401 GET \/api\/portal\/me$/]);
  await portal.goto("/portal");
  await portal.getByLabel("Benutzername").fill(username);
  await portal.getByLabel("Passwort", { exact: true }).fill(password);
  await portal.getByRole("button", { name: "Anmelden" }).click();
  await portal.getByLabel("Einmal-Passwort").fill(password);
  await portal.getByLabel("Neues Passwort", { exact: true }).fill("Portal-Passwort-2026");
  await portal.getByLabel("Neues Passwort wiederholen").fill("Portal-Passwort-2026");
  await portal.getByRole("button", { name: "Passwort speichern" }).click();

  const visit = portal.getByRole("region", { name: "Visite" });
  const item = visit.locator("li", { hasText: question });
  await expect(item).toBeVisible();
  await item.getByLabel("Rückmeldung").fill("Salbe zweimal täglich weiter, Kontrolle nächste Woche");
  await item.getByRole("button", { name: "Rückmeldung speichern" }).click();
  await expect(visit.locator("li", { hasText: question }).getByLabel("Rückmeldung")).toHaveCount(0);
  await expect(visit).toContainText("Salbe zweimal täglich weiter, Kontrolle nächste Woche");
  expect(portalErrors).toEqual([]);
  await portalContext.close();

  await page.goto("/c/pflegedokumentation/visite");
  await expect(page.locator(".visit-resident li", { hasText: question })).toHaveCount(0);
  const resolved = page.getByRole("region", { name: "Rückmeldungen der letzten 14 Tage" });
  await expect(resolved).toContainText(question);
  await expect(resolved).toContainText(`erfasst von ${name} (Portal)`);
  expect(errors).toEqual([]);
});
