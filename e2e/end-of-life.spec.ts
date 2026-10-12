import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

// Wünsche für die letzte Lebensphase in den Stammdaten; nach einem Todesfall die Checkliste, deren Punkte die
// Einrichtung selbst festlegt.
test("Lebensende: Checkliste festlegen, Wünsche erfassen, nach dem Todesfall abhaken", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const tag = Date.now().toString().slice(-6);

  await page.goto("/c/leitung/administration/konfiguration");
  const card = page.getByRole("region", { name: "Checkliste nach einem Todesfall" });
  await card.getByRole("button", { name: /Festlegen|Bearbeiten/ }).click();
  const setup = page.getByRole("dialog", { name: "Checkliste nach einem Todesfall" });
  await setup.getByLabel("Punkte").fill("Ärztin informiert\nAngehörige informiert\nBestattung beauftragt");
  await setup.getByRole("button", { name: "Checkliste speichern" }).click();
  await expect(setup).toHaveCount(0);
  await expect(card.locator(".admin-retention-row")).toHaveText([
    "1. Ärztin informiert",
    "2. Angehörige informiert",
    "3. Bestattung beauftragt",
  ]);

  const units = (await (await page.request.get("/api/organization")).json()) as {
    units: Array<{ id: string; name: string }>;
  };
  const room = await page.request.post("/api/occupancy/rooms", {
    data: { careUnitId: units.units[0].id, name: `E${tag}`, beds: 1 },
  });
  expect(room.status()).toBe(201);
  const created = await page.request.post("/api/residents", {
    data: {
      // Am Ende der Liste, damit Tests mit festen Zeilen (z. B. „zweite Person“) unverändert bleiben.
      firstName: "Lea",
      lastName: `Zwicky${tag}`,
      unit: units.units[0].name,
      room: `E${tag}`,
      birthDate: "1935-04-02",
      admissionDate: "2026-01-05",
      careLevel: "Noch nicht eingestuft",
    },
  });
  expect(created.status()).toBeLessThan(300);
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/c/bewohner?resident=${id}`);
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  const wishes = page.getByRole("region", { name: "Wünsche für die letzte Lebensphase" });
  await expect(wishes).toContainText("Noch keine Wünsche erfasst");
  await wishes.getByRole("button", { name: "Erfassen" }).click();
  const dialog = page.getByRole("dialog", { name: "Wünsche für die letzte Lebensphase" });
  await dialog.getByLabel("Ort").fill("Im eigenen Zimmer, mit Blick in den Garten");
  await dialog.getByLabel("Wer informiert werden soll").fill("Tochter, auch nachts");
  await dialog.getByLabel("Besprochen mit").fill("der Person selbst");
  await dialog.getByRole("button", { name: "Wünsche speichern" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(wishes).toContainText("Im eigenen Zimmer, mit Blick in den Garten");
  await expect(wishes).toContainText("Tochter, auch nachts");
  await expect(wishes).toContainText("mit der Person selbst");
  await expect(page.getByRole("region", { name: "Ablauf nach dem Todesfall" })).toHaveCount(0);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
  const exit = await page.request.post(`/api/resident-history/${id}/exit`, {
    data: { kind: "deceased", date: today, note: "Im Beisein der Tochter verstorben." },
  });
  expect(exit.ok()).toBe(true);

  await page.reload();
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  const checklist = page.getByRole("region", { name: "Ablauf nach dem Todesfall" });
  await expect(checklist.locator("li")).toHaveCount(3);
  await checklist.getByRole("button", { name: "Ärztin informiert erledigt" }).click();
  const done = page.getByRole("dialog", { name: "Ärztin informiert" });
  await done.getByLabel("Vermerk (freiwillig)").fill("telefonisch erreicht");
  await done.getByRole("button", { name: "Als erledigt markieren" }).click();
  await expect(done).toHaveCount(0);
  const first = checklist.locator("li").first();
  await expect(first).toHaveClass(/done/);
  await expect(first).toContainText("telefonisch erreicht");
  await first.getByRole("button", { name: "Ärztin informiert wieder öffnen" }).click();
  await expect(first).not.toHaveClass(/done/);
  expect(errors).toEqual([]);
});
