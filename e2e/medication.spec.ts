import { expect, test } from "@playwright/test";
import { ADMIN, FAGE, SRK, field, login, watchErrors } from "./support";

// Läuft der Reihe nach auf den Demodaten: Metoprolol (Stationsbestand Wohnbereich 2) wird als BtM geführt.
test.describe.configure({ mode: "serial" });

test("BtM: Kennzeichnen, Eingang nur mit gültiger Zweitunterschrift, Kontrolle und BtM-Buch", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page, [/^403 POST \/api\/medication\/stock$/]);
  await page.goto("/c/medikation/btm");
  const medication = page.locator(".btm-medications li", { hasText: "Metoprolol" });
  await medication.getByRole("button", { name: "Als BtM führen" }).click();
  await expect(medication.getByRole("button", { name: "Kennzeichnung aufheben" })).toBeVisible();
  const stock = page.locator(".btm-list article", { hasText: "Metoprolol" });
  await expect(stock).toBeVisible();
  const before = Number((await stock.locator("strong", { hasText: "Tabletten" }).first().innerText()).match(/\d+/)![0]);

  // Eingang: falsches Passwort und eine Pflegehelferin SRK werden abgelehnt, eine FaGe bestätigt.
  await page.getByRole("button", { name: "BtM-Eingang" }).click();
  await field(page, "Menge").fill("10");
  await field(page, "Bemerkung").fill("Lieferung Apotheke");
  await field(page, "Benutzername").fill(FAGE.username);
  await field(page, "Passwort").fill("falsch");
  await page.getByRole("button", { name: "Eingang buchen" }).click();
  await expect(page.locator(".editor-dialog [role=alert]")).toContainText("Zweitunterschrift ist ungültig");
  await field(page, "Benutzername").fill(SRK.username);
  await field(page, "Passwort").fill(SRK.password);
  await page.getByRole("button", { name: "Eingang buchen" }).click();
  await expect(page.locator(".editor-dialog [role=alert]")).toContainText("nicht für Medikation berechtigt");
  await field(page, "Benutzername").fill(FAGE.username);
  await field(page, "Passwort").fill(FAGE.password);
  await page.getByRole("button", { name: "Eingang buchen" }).click();
  await expect(page.locator(".editor-dialog")).toHaveCount(0);
  await expect(stock.locator("strong", { hasText: "Tabletten" }).first()).toContainText(`${before + 10} Tabletten`);

  // Bestandskontrolle ohne Differenz.
  await stock.getByRole("button", { name: "Kontrolle" }).click();
  await field(page, "Gezählter Bestand").fill(String(before + 10));
  await expect(page.locator(".btm-difference")).toContainText("Bestand stimmt");
  await field(page, "Benutzername").fill(FAGE.username);
  await field(page, "Passwort").fill(FAGE.password);
  await page.getByRole("button", { name: "Kontrolle speichern" }).click();
  await expect(page.locator(".editor-dialog")).toHaveCount(0);
  await expect(stock).toContainText("ohne Differenz");

  // BtM-Buch: Kontrolle und Eingang mit Person und Zweitunterschrift.
  await stock.getByRole("button", { name: "BtM-Buch" }).click();
  const book = page.locator(".btm-book");
  await expect(book.locator("tbody tr").nth(0)).toContainText("Bestandskontrolle");
  await expect(book.locator("tbody tr").nth(1)).toContainText("Eingang");
  await expect(book.locator("tbody tr").nth(1)).toContainText("Lena");
  expect(errors).toEqual([]);
});

test("BtM-Kennzeichen erscheint in der Medikamentenrunde", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/medikation/runde");
  await page.locator(".med-round-card button", { hasText: /runde/ }).first().click();
  await page.getByRole("option", { name: /Morgenrunde/ }).click();
  await expect(page.locator(".med-round-card", { hasText: "Metoprolol" }).locator(".btm-badge").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Medikationsrecht: Pflegehelferin SRK nur Ansicht, Fachperson Gesundheit dokumentiert", async ({ page }) => {
  await login(page, SRK);
  await page.goto("/c/medikation/runde");
  await expect(page.locator(".med-round-readonly")).toContainText("Nur Ansicht");
  const denied = await page.request.patch("/api/medication/btm/medications/00000000-0000-4000-8000-000000000000", {
    data: { controlled: true },
  });
  expect(denied.status(), "ohne Medikationsrecht").toBe(403);
  await page.context().clearCookies();
  await login(page, FAGE);
  await page.goto("/c/medikation/runde");
  await expect(page.locator(".med-round-card")).toBeVisible();
  await expect(page.locator(".med-round-readonly")).toHaveCount(0);
});

test("Wirkungskontrolle: nach Reservegabe fällig, Ergebnis wird dokumentiert", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const { residents } = (await (await page.request.get("/api/medication/residents")).json()) as {
    residents: Array<{ id: string; name: string }>;
  };
  const target = residents[residents.length - 1];
  const name = `E2E Novalgin ${Date.now()}`;
  const medication = { name, strength: "500 mg", form: "Tablette" };
  const order = await page.request.post("/api/medication/orders", {
    data: {
      ...medication,
      residentId: target.id,
      amount: "1 Tablette",
      stockQuantity: 1,
      prescribedBy: "Dr. Weber",
      startOn: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      isPrn: true,
      maxDosesPer24h: 3,
      minIntervalHours: 6,
      indication: "Schmerzen",
      effectCheckMinutes: 30,
    },
  });
  expect(order.status()).toBe(201);
  const { id: orderId } = (await order.json()) as { id: string };
  const stock = await page.request.post("/api/medication/stock", {
    data: { ...medication, residentId: target.id, quantity: 10, unit: "Tabletten" },
  });
  expect(stock.status()).toBe(201);
  const given = await page.request.post("/api/medication/prn", { data: { orderId, note: "Schmerzen NRS 6" } });
  expect(given.status()).toBe(201);

  await page.addInitScript((id) => window.sessionStorage.setItem("carecore.residentId", id), target.id);
  await page.goto("/c/medikation/reserven");
  const card = page.locator(".med-effect-card");
  const item = card.locator("article", { hasText: name });
  await expect(item).toContainText("Schmerzen NRS 6");
  await expect(item.locator(".status-badge")).toContainText("Fällig um");
  await item.getByRole("button", { name: "Wirkung erfassen" }).click();
  const dialog = page.locator(".editor-dialog");
  await dialog.getByRole("button", { name: "Teilweise wirksam" }).click();
  await field(page, "Einschätzung und Massnahme").fill("NRS 3, Lagerung angepasst");
  await dialog.getByRole("button", { name: "Wirkung dokumentieren" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Wirkungskontrolle dokumentiert");
  await expect(card.locator("article", { hasText: name })).toHaveCount(0);

  const docs = (await (await page.request.get(`/api/documentation?residentId=${target.id}&days=1`)).json()) as {
    entries: Array<{ body: string }>;
  };
  expect(
    docs.entries.some(
      (entry) => entry.body.includes(`${name} 500 mg`) && entry.body.includes("Teilweise wirksam – NRS 3"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("Wechselwirkungen: Hinweis der Einrichtung erscheint im Medikamentenplan, bis er entfernt wird", async ({
  page,
}) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const { residents } = (await (await page.request.get("/api/medication/residents")).json()) as {
    residents: Array<{ id: string; name: string; regularCount: number }>;
  };
  const target = residents.find((resident) => resident.regularCount >= 2) ?? residents[0];
  const created: string[] = [];
  for (const name of ["Testpräparat Alpha", "Testpräparat Beta"]) {
    const response = await page.request.post("/api/medication/orders", {
      data: {
        residentId: target.id,
        name,
        amount: "1 Tablette",
        prescribedBy: "Dr. Klicktest",
        startOn: "2026-01-01",
        times: ["08:00"],
      },
    });
    expect(response.status()).toBe(201);
    created.push(((await response.json()) as { id: string }).id);
  }

  await page.goto("/c/leitung/administration/konfiguration");
  const card = page.locator(".admin-interactions-card");
  await expect(card).toContainText("Lizenzierte Arzneimitteldatenbank: nicht angebunden");
  await card.getByRole("button", { name: "Hinweis erfassen" }).click();
  await field(page, "Wirkstoff / Präparat A").fill("Alpha");
  await field(page, "Wirkstoff / Präparat B").fill("Beta");
  await field(page, "Quelle").fill("Apotheke Klicktest");
  await field(page, "Wechselwirkung").fill("Wirkung verstärkt");
  await page.locator(".editor-dialog").getByRole("button", { name: "Speichern" }).click();
  await expect(card.locator(".admin-retention-row", { hasText: "Alpha + Beta" })).toBeVisible();

  await page.addInitScript((id) => window.sessionStorage.setItem("carecore.residentId", id), target.id);
  await page.goto("/c/medikation");
  const notice = page.locator(".med-interaction-card");
  await expect(notice).toContainText("Testpräparat Alpha + Testpräparat Beta");
  await expect(notice).toContainText("Quelle: Apotheke Klicktest");
  await expect(notice).toContainText("keine Unbedenklichkeit");

  await page.goto("/c/leitung/administration/konfiguration");
  await card
    .locator(".admin-retention-row", { hasText: "Alpha + Beta" })
    .getByRole("button", { name: "Entfernen" })
    .click();
  await page.locator(".editor-dialog").getByRole("button", { name: "Entfernen" }).click();
  await expect(card.locator(".admin-retention-row", { hasText: "Alpha + Beta" })).toHaveCount(0);
  await page.goto("/c/medikation");
  await expect(page.locator(".med-plan-list")).toContainText("Testpräparat Alpha");
  await expect(page.locator(".med-interaction-card")).toHaveCount(0);
  // Aufräumen: Testverordnungen absetzen, damit die übrigen Tests die Demodaten unverändert vorfinden.
  for (const id of created)
    expect(
      (
        await page.request.patch(`/api/medication/orders/${id}`, {
          data: { status: "stopped", reason: "Klicktest" },
        })
      ).status(),
    ).toBe(200);
  expect(errors).toEqual([]);
});
