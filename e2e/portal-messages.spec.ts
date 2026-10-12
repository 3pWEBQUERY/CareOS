import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { ADMIN, field, login, pickDate, watchErrors } from "./support";

// Portal ↔ Pflege: Angehörige schreibt aus dem Portal, die Pflege antwortet in „Portal-Nachrichten“.
// Apothekenportal: die Pflege bestellt, die Apotheke bestätigt mit Liefertag.
test.describe.configure({ mode: "serial" });

async function portalAccount(
  staff: APIRequestContext,
  kind: "relative" | "pharmacy",
  name: string,
  grant: Record<string, unknown>,
) {
  const username = `${kind}-${Date.now().toString(36)}`;
  const created = await staff.post("/api/admin/portal", { data: { kind, displayName: name, username } });
  expect(created.status()).toBe(201);
  const { id, password } = (await created.json()) as { id: string; password: string };
  expect(
    (await staff.post("/api/admin/portal/grants", { data: { accountId: id, basis: "consent", ...grant } })).status(),
  ).toBe(201);
  return { username, password };
}

async function portalPage(browser: Browser, account: { username: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  expect((await page.request.post("/api/portal/auth/login", { data: account })).ok()).toBe(true);
  const changed = await page.request.post("/api/portal/auth/password", {
    data: { current: account.password, next: "Portal-Klicktest-2026" },
  });
  expect(changed.ok()).toBe(true);
  await page.goto("/portal");
  return { page, context };
}

test("Portal-Nachrichten: Angehörige schreibt, Pflege antwortet, Antwort im Portal", async ({ page, browser }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const { residents } = (await (await page.request.get("/api/medication/residents")).json()) as {
    residents: Array<{ id: string; name: string }>;
  };
  const account = await portalAccount(page.request, "relative", "Petra Klicktest", {
    residentId: residents[0].id,
    areas: ["medication", "messages"],
  });
  const subject = `Besuch ${Date.now().toString(36)}`;
  const portal = await portalPage(browser, account);
  await portal.page.getByRole("button", { name: "Nachrichten" }).click();
  await portal.page.getByRole("button", { name: "Neue Nachricht" }).click();
  await portal.page.getByLabel("Betreff").fill(subject);
  await portal.page.getByLabel("Nachricht").fill("Darf ich am Sonntag um 14 Uhr kommen?");
  await portal.page.getByRole("button", { name: "Senden" }).click();
  await expect(portal.page.locator(".portal-conversation")).toContainText("Darf ich am Sonntag");

  await page.goto("/c/carecore-one/portal-nachrichten");
  await page.locator(".portal-thread-list button", { hasText: subject }).click();
  const conversation = page.locator(".portal-conversation");
  await expect(conversation).toContainText("Darf ich am Sonntag um 14 Uhr kommen?");
  await conversation.getByLabel("Antwort").fill("Gerne, bis Sonntag.");
  await conversation.getByRole("button", { name: "Senden" }).click();
  await expect(conversation).toContainText("Gerne, bis Sonntag.");

  await portal.page.reload();
  await portal.page.getByRole("button", { name: "Nachrichten" }).click();
  await portal.page.locator(".portal-thread-list button", { hasText: subject }).click();
  await expect(portal.page.locator(".portal-conversation")).toContainText("Gerne, bis Sonntag.");
  await portal.context.close();
  expect(errors).toEqual([]);
});

test("Apothekenportal: Bestellung erfassen, Apotheke bestätigt mit Liefertag", async ({ page, browser }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const { careUnits } = (await (await page.request.get("/api/admin/portal")).json()) as {
    careUnits: Array<{ id: string; name: string }>;
  };
  const name = `Apotheke ${Date.now().toString(36)}`;
  const account = await portalAccount(page.request, "pharmacy", name, {
    careUnitId: careUnits[0].id,
    areas: ["medication"],
    basis: "treatment",
  });

  await page.goto("/c/medikation/bestellungen");
  await page.getByRole("button", { name: "Bestellung erfassen" }).click();
  const dialog = page.locator(".editor-dialog");
  await dialog.locator("[role=combobox]").first().click();
  await page.getByRole("option", { name }).click();
  await field(page, "Präparat").fill("Metformin");
  await field(page, "Stärke").fill("500 mg");
  await field(page, "Menge").fill("2");
  await field(page, "Einheit").fill("Packungen");
  await dialog.getByRole("button", { name: "Bestellen" }).click();
  const order = page.locator(".med-orders-list > li", { hasText: name });
  await expect(order).toContainText("Offen");
  await expect(order).toContainText("2 Packungen Metformin 500 mg");

  const portal = await portalPage(browser, account);
  const card = portal.page.locator(".portal-order").first();
  await expect(card).toContainText("2 Packungen Metformin 500 mg");
  await pickDate(card, "Liefertag", "2026-10-02");
  await card.getByRole("button", { name: "Bestätigen" }).click();
  await expect(portal.page.locator(".portal-order").first()).toContainText("Bestätigt");
  await portal.context.close();

  await page.reload();
  await expect(order).toContainText("Bestätigt");
  await expect(order).toContainText("02.10.2026");
  expect(errors).toEqual([]);
});
