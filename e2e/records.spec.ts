import { expect, test } from "@playwright/test";
import { ADMIN, FAGE, field, login, watchErrors } from "./support";

test("Bewohnerakte: Änderungsprotokoll nur für die Leitung, Pflege sieht alle Bewohner", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner");
  const rows = page.locator(".resident-list-row");
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();
  await rows.first().click();
  await page.locator(".resident-record-tabs button", { hasText: "Verlauf" }).click();
  await expect(page.locator(".record-audit-card")).toBeVisible();
  expect(errors).toEqual([]);

  await page.context().clearCookies();
  await login(page, FAGE);
  await page.goto("/c/bewohner");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBe(total);
  await rows.first().click();
  await page.locator(".resident-record-tabs button", { hasText: "Verlauf" }).click();
  await expect(page.locator(".resident-record-tabs")).toBeVisible();
  await expect(page.locator(".record-audit-card")).toHaveCount(0);
});

test("Qualität: Bearbeiten einer Massnahme speichert Titel und Termin", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const created = await page.request.post("/api/quality/actions", {
    data: { title: "E2E Doppelkontrolle", dueOn: "2030-01-15" },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await page.goto("/c/leitung/qualitaet/massnahmen");
  await page.getByText("E2E Doppelkontrolle").first().click();
  await page
    .getByRole("button", { name: /Bearbeiten/ })
    .first()
    .click();
  await field(page, "Massnahme").fill("E2E Doppelkontrolle Hochrisiko");
  await page.locator(".editor-dialog footer button[type=submit]").click();
  await expect(page.locator(".editor-dialog")).toHaveCount(0);
  const list = (await (await page.request.get("/api/quality/actions")).json()) as {
    actions: Array<{ id: string; title: string }>;
  };
  expect(list.actions.find((action) => action.id === id)?.title).toBe("E2E Doppelkontrolle Hochrisiko");
  expect(errors).toEqual([]);
});

test("Bewohnerakte: Dokument (PDF) über die Ablagefläche hochladen, Word-Datei wird abgewiesen", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  await page.locator(".resident-record-tabs button", { hasText: "Dokumente" }).click();
  await page.getByRole("button", { name: "Dokument hochladen" }).click();
  const dialog = page.locator(".editor-dialog");
  const input = dialog.locator('input[type="file"]');
  await expect(input).toHaveAttribute("accept", "application/pdf,image/jpeg,image/png,image/webp");
  await input.setInputFiles({
    name: "Brief.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK\u0003\u0004"),
  });
  await expect(dialog.getByRole("alert")).toContainText("PDF oder ein Bild");
  await input.setInputFiles({
    name: "Austrittsbericht Spital.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n"),
  });
  await expect(dialog.locator(".document-file-selected")).toContainText("Austrittsbericht Spital.pdf");
  await expect(field(page, "Titel")).toHaveValue("Austrittsbericht Spital");
  await dialog.getByRole("button", { name: "Hochladen", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Austrittsbericht Spital").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Körperübersicht: Klick auf die Figur öffnet direkt „Befund erfassen“, Ziehen dreht nur", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").first().click();
  const canvas = page.locator(".clinical-body-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await expect(page.locator(".clinical-body-status")).toHaveCount(0);
  await expect(page.getByText("3D-Referenz")).toHaveCount(0);
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.42;

  // Ziehen dreht das Modell und erfasst nichts.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Befund erfassen" })).toHaveCount(0);

  // Zurück nach vorne und direkt auf den Bauch klicken.
  await page.locator(".body-map-card").getByRole("button", { name: "Vorne" }).click();
  await page.waitForTimeout(600);
  await page.mouse.click(x, y);
  const dialog = page.getByRole("dialog", { name: "Befund erfassen" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Körperstelle" })).toHaveValue(/bauch/i);
  expect(errors).toEqual([]);
});

test("Reanimationsstatus: in den Stammdaten erfassen, im Aktenkopf und im Überleitungsbogen sichtbar", async ({
  page,
}) => {
  await login(page, ADMIN);
  // Der absichtlich unvollständige Speicherversuch wird mit 400 abgewiesen.
  const errors = watchErrors(page, [/^400 PATCH \/api\/residents\/[^/]+\/record$/]);
  await page.goto("/c/bewohner");
  const row = page.locator(".resident-list-row").nth(1);
  // REA-Status direkt auf der Karte im Verzeichnis, ohne die Akte zu öffnen.
  await expect(row.locator(".rea-badge")).toBeVisible();
  await row.click();
  const badge = page.locator(".record-resuscitation");
  await expect(badge).toBeVisible();
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  await page.getByRole("button", { name: "Stammdaten bearbeiten" }).click();
  await page.getByRole("combobox", { name: "Reanimationsstatus" }).click();
  await page.getByRole("option", { name: "Keine Reanimation (DNR)" }).click();
  // Ohne Grundlage wird nicht gespeichert.
  await page.getByLabel("Grundlage").fill("");
  await page.getByRole("button", { name: "Stammdaten speichern" }).click();
  await expect(page.locator(".record-master-data-view [role=alert]")).toContainText("Grundlage");
  await page.getByLabel("Grundlage").fill("Patientenverfügung");
  await page.getByRole("button", { name: "Stammdaten speichern" }).click();
  await expect(page.getByRole("button", { name: "Stammdaten bearbeiten" })).toBeVisible();
  await expect(badge).toHaveText("REA: Nein");
  await expect(badge).toHaveClass(/critical/);
  const href = await page.locator(".record-transfer-link").getAttribute("href");
  await page.goto(href ?? "");
  await expect(page.locator(".transfer-resuscitation")).toContainText(
    "Keine Reanimation (DNR) · Grundlage: Patientenverfügung",
  );
  // Nach dem Speichern zeigen alle Karten den neuen Stand.
  await page.goto("/c/bewohner");
  await expect(
    page.locator(".resident-list-row").nth(1).getByRole("img", { name: "Keine Reanimation (DNR)" }),
  ).toHaveText("REA Nein");

  expect(errors).toEqual([]);
});

test("Änderungsprotokoll: Eintrag nennt Person und Gerät der Anmeldung", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  await page.goto("/c/bewohner");
  await page.locator(".resident-list-row").nth(2).click();
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  await page.getByRole("button", { name: "Stammdaten bearbeiten" }).click();
  await page.getByRole("button", { name: "Stammdaten speichern" }).click();
  await expect(page.getByRole("button", { name: "Stammdaten bearbeiten" })).toBeVisible();
  await page.locator(".resident-record-tabs button", { hasText: "Verlauf" }).click();
  const card = page.locator(".record-audit-card");
  await card.getByRole("button", { name: /Anzeigen/ }).click();
  const latest = card.locator("li").first();
  await expect(latest).toContainText("Stammdaten geändert");
  // Der Test-Browser meldet sich als Chrome (Betriebssystem je nach Playwright-Profil).
  await expect(latest.locator("em")).toContainText(/ · Chrome · (Windows|Linux|Mac)$/);
  expect(errors).toEqual([]);
});
