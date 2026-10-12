import { expect, test, type Page } from "@playwright/test";
import { E2E_SMTP_PORT } from "../playwright.config";
import { ADMIN, login, watchErrors } from "./support";

// E-Mail-Versand gegen den Test-Mailserver: neue Person per E-Mail einladen, Passwort über den Link setzen,
// „Passwort vergessen“ auf der Anmeldeseite und Link der Administration. Links gelten nur einmal.
const mailbox = `http://127.0.0.1:${E2E_SMTP_PORT + 1}/messages`;
type Mail = { to: string[]; subject: string; body: string };
const mailsTo = async (email: string) =>
  ((await (await fetch(mailbox)).json()) as Mail[]).filter((mail) => mail.to.includes(email));
const linkIn = (mail: Mail) => /http:\/\/localhost:\d+(\/passwort\?token=[A-Za-z0-9_-]+)/.exec(mail.body)?.[1] ?? "";

async function setPassword(page: Page, path: string, password: string) {
  await page.goto(path);
  await page.getByLabel("Neues Passwort").fill(password);
  await page.getByLabel("Passwort wiederholen").fill(password);
  await page.getByRole("button", { name: "Passwort speichern" }).click();
  await expect(page.getByRole("heading", { name: "Passwort gespeichert" })).toBeVisible();
}

test("E-Mail: einladen, Passwort setzen, Passwort vergessen, Link der Administration", async ({ page, browser }) => {
  const stamp = Date.now().toString(36);
  const username = `mail.${stamp}`;
  const email = `mail.${stamp}@heim.test`;
  await login(page, ADMIN);
  const errors = watchErrors(page);

  // Neue Person mit E-Mail-Adresse: Einladung statt Startpasswort.
  await page.goto("/c/leitung/administration/benutzer");
  await page.getByRole("button", { name: "Mitarbeiter erstellen" }).first().click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Name", { exact: true }).fill(`Mail Test ${stamp}`);
  await editor.getByLabel("Benutzername", { exact: true }).fill(username);
  await editor.getByLabel("E-Mail", { exact: true }).fill(email);
  await expect(editor.getByLabel("Per E-Mail einladen")).toBeChecked();
  await expect(editor.getByLabel("Startpasswort")).toHaveCount(0);
  await editor.getByRole("button", { name: "Mitarbeiter erstellen" }).click();
  await expect(page.locator(".toast")).toContainText(`Einladung an ${email} gesendet`);
  await expect.poll(async () => (await mailsTo(email)).length).toBe(1);
  const [invite] = await mailsTo(email);
  expect(invite.subject).toContain("Zugang einrichten");
  expect(invite.body).toContain(username);

  // Ohne Anmeldung: Passwort über die Einladung setzen und anmelden.
  const guest = await browser.newPage();
  const guestErrors = watchErrors(guest);
  await setPassword(guest, linkIn(invite), "Erstes-Passwort-2026");
  expect(
    (await guest.request.post("/api/auth/login", { data: { username, password: "Erstes-Passwort-2026" } })).status(),
  ).toBe(200);
  // Derselbe Link ein zweites Mal: abgelaufen.
  await guest.goto(linkIn(invite));
  await expect(guest.getByText("Der Link ist abgelaufen oder wurde bereits verwendet.")).toBeVisible();

  // Passwort vergessen auf der Anmeldeseite (über die E-Mail-Adresse).
  await guest.context().clearCookies();
  await guest.goto("/");
  await guest.getByRole("button", { name: "Passwort vergessen?" }).click();
  await guest.getByLabel("Benutzername oder E-Mail").fill(email);
  await guest.getByRole("button", { name: "Link senden" }).click();
  await expect(guest.getByRole("status")).toContainText("ist ein Link unterwegs");
  await expect.poll(async () => (await mailsTo(email)).length).toBe(2);
  const reset = (await mailsTo(email))[1];
  expect(reset.subject).toContain("Passwort neu setzen");
  await setPassword(guest, linkIn(reset), "Zweites-Passwort-2026");
  expect(
    (await guest.request.post("/api/auth/login", { data: { username, password: "Erstes-Passwort-2026" } })).status(),
  ).toBe(401);
  expect(
    (await guest.request.post("/api/auth/login", { data: { username, password: "Zweites-Passwort-2026" } })).status(),
  ).toBe(200);

  // Administration: Link erneut senden.
  await page.reload();
  await page.locator(".admin-user-row", { hasText: `Mail Test ${stamp}` }).click();
  await page.getByRole("button", { name: "Link zum Passwort setzen senden" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link an" })).toContainText(email);
  await expect.poll(async () => (await mailsTo(email)).length).toBe(3);

  // Unbekannte Konten: dieselbe Antwort, keine E-Mail.
  const before = ((await (await fetch(mailbox)).json()) as Mail[]).length;
  const unknown = await guest.request.post("/api/auth/password", { data: { identifier: "gibt.es.nicht" } });
  expect(unknown.status()).toBe(200);
  expect(((await (await fetch(mailbox)).json()) as Mail[]).length).toBe(before);

  expect(errors).toEqual([]);
  // Der zweite Aufruf des eingelösten Links meldet 410 nicht (die Seite prüft per GET), also keine Fehler.
  expect(guestErrors).toEqual([]);
  await guest.close();
});
