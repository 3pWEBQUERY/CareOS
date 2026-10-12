// Bildschirmfotos für die Hilfe im Portal (public/portal-hilfe/*.png), aus dem echten Portal mit Testdaten.
// Voraussetzung: laufende App mit Demodaten (wie für die Klicktests: npm run test:e2e:setup, next build, next start).
// Aufruf: BASE_URL=http://localhost:3200 ADMIN_PASSWORD=… node scripts/portal-help-screenshots.mjs
import { mkdir } from "node:fs/promises";
import { chromium, request } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3200";
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) throw new Error("ADMIN_PASSWORD fehlt (Passwort des Administrators der Testdaten).");
const out = "public/portal-hilfe";
await mkdir(out, { recursive: true });

const staff = await request.newContext({ baseURL: base });
const check = async (response, label) => {
  if (!response.ok()) throw new Error(`${label}: ${response.status()} ${await response.text()}`);
  return response.json();
};
await check(await staff.post("/api/auth/login", { data: { username: "Admin", password: adminPassword } }), "Anmeldung");
const { residents } = await check(await staff.get("/api/medication/residents"), "Personen");
const resident = residents[0];
const stamp = Date.now().toString(36);
const { careUnits } = await check(await staff.get("/api/admin/portal"), "Portal");

// Angehörige mit Freigabe für eine Person; Apotheke für den ersten Wohnbereich.
const relative = await check(
  await staff.post("/api/admin/portal", {
    data: { kind: "relative", displayName: "Petra Muster", username: `petra.muster.${stamp}` },
  }),
  "Zugang Angehörige",
);
await check(
  await staff.post("/api/admin/portal/grants", {
    data: {
      accountId: relative.id,
      residentId: resident.id,
      areas: ["emergency", "medication", "vitals", "appointments", "messages"],
      basis: "consent",
      basisNote: "Einwilligung schriftlich",
    },
  }),
  "Freigabe Angehörige",
);
const pharmacy = await check(
  await staff.post("/api/admin/portal", {
    data: { kind: "pharmacy", displayName: "Apotheke am Platz", username: `apotheke.${stamp}` },
  }),
  "Zugang Apotheke",
);
await check(
  await staff.post("/api/admin/portal/grants", {
    data: {
      accountId: pharmacy.id,
      careUnitId: careUnits[0].id,
      areas: ["medication", "messages"],
      basis: "treatment",
    },
  }),
  "Freigabe Apotheke",
);
await check(
  await staff.post("/api/pharmacy/orders", {
    data: {
      pharmacyId: pharmacy.id,
      careUnitId: careUnits[0].id,
      note: "Lieferung bitte bis Freitag.",
      items: [
        { medication: "Metformin", strength: "500 mg", quantity: 2, unit: "Packungen" },
        { medication: "Paracetamol", strength: "500 mg", quantity: 1, unit: "Packung" },
      ],
    },
  }),
  "Bestellung",
);

const browser = await chromium.launch();
const shot = async (page, name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
const portalPage = async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 750 }, locale: "de-CH" });
  return context.newPage();
};

// 1–4: Angehörige
const page = await portalPage();
await page.goto(`${base}/portal`);
await page.getByLabel("Benutzername").fill(`petra.muster.${stamp}`);
await page.getByLabel("Passwort", { exact: true }).fill("••••••••••••");
await shot(page, "01-anmeldung");
await page.getByLabel("Passwort", { exact: true }).fill(relative.password);
await page.getByRole("button", { name: "Anmelden" }).click();
await page.getByRole("heading", { name: "Bitte ein eigenes Passwort festlegen" }).waitFor();
await page.getByLabel("Einmal-Passwort").fill(relative.password);
await page.getByLabel("Neues Passwort", { exact: true }).fill("Portal-Hilfe-2026");
await page.getByLabel("Neues Passwort wiederholen").fill("Portal-Hilfe-2026");
await shot(page, "02-passwort");
await page.getByRole("button", { name: "Passwort speichern" }).click();
await page.getByRole("heading", { name: "Notfalldaten" }).waitFor();
await shot(page, "03-personen");

await page.getByRole("button", { name: "Nachrichten" }).click();
await page.getByRole("button", { name: "Neue Nachricht" }).click();
await page.getByLabel("Betreff").fill("Besuch am Sonntag");
await page.getByLabel("Nachricht").fill("Guten Tag, darf ich am Sonntag um 14 Uhr zu Besuch kommen?");
await page.getByRole("button", { name: "Senden" }).click();
await page.locator(".portal-conversation").waitFor();
const { threads } = await check(await staff.get("/api/portal-messages"), "Portal-Nachrichten");
await check(
  await staff.post("/api/portal-messages", {
    data: { threadId: threads[0].id, body: "Gerne, wir freuen uns auf Ihren Besuch. Freundliche Grüsse, die Pflege" },
  }),
  "Antwort",
);
await page.getByRole("button", { name: "Besuch am Sonntag" }).click();
await page.getByText("wir freuen uns").waitFor();
await shot(page, "04-nachrichten");

// 5: Apotheke
const pharmacyPage = await portalPage();
await pharmacyPage.goto(`${base}/portal`);
await pharmacyPage.getByLabel("Benutzername").fill(`apotheke.${stamp}`);
await pharmacyPage.getByLabel("Passwort", { exact: true }).fill(pharmacy.password);
await pharmacyPage.getByRole("button", { name: "Anmelden" }).click();
await pharmacyPage.getByLabel("Einmal-Passwort").fill(pharmacy.password);
await pharmacyPage.getByLabel("Neues Passwort", { exact: true }).fill("Apotheke-Hilfe-2026");
await pharmacyPage.getByLabel("Neues Passwort wiederholen").fill("Apotheke-Hilfe-2026");
await pharmacyPage.getByRole("button", { name: "Passwort speichern" }).click();
await pharmacyPage.getByRole("heading", { name: "Bestellungen der Einrichtung" }).waitFor();
await shot(pharmacyPage, "05-bestellungen");

await browser.close();
await staff.dispose();
console.log(`5 Bilder in ${out}/`);
