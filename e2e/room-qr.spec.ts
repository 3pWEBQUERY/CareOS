import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";
import type { OccupancyOverview } from "../lib/occupancy-shared";

// QR-Code je Zimmer: Etiketten des Wohnbereichs drucken; der Code führt nach der Anmeldung zur Akte der Person im Zimmer.
test("QR-Etiketten: Etiketten je Zimmer, Scan öffnet die Akte", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const overview = (await (await page.request.get("/api/occupancy")).json()) as OccupancyOverview;
  const unit = overview.units.find((item) =>
    item.rooms.some(
      (room) => room.active && room.occupants.filter((person) => person.status === "active").length === 1,
    ),
  )!;
  const room = unit.rooms.find(
    (item) => item.active && item.occupants.filter((person) => person.status === "active").length === 1,
  )!;
  const resident = room.occupants.find((person) => person.status === "active")!;

  await page.goto("/c/bewohner/belegung");
  const link = page.getByRole("link", { name: `QR-Etiketten ${unit.name} drucken` });
  await expect(link).toHaveAttribute("href", `/c/bewohner/belegung/etiketten?unit=${unit.id}`);

  await page.goto(`/c/bewohner/belegung/etiketten?unit=${unit.id}&dialog=0`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`QR-Etiketten · ${unit.name}`);
  const labels = page.locator(".room-labels li");
  await expect(labels).toHaveCount(unit.rooms.filter((item) => item.active).length);
  const label = page.getByRole("listitem", { name: `Etikett ${room.name}` });
  await expect(label.locator("svg")).toBeVisible();
  await expect(label).toContainText(unit.name);

  // Auf dem Handy passt die Vorschau in die Breite (kein seitliches Scrollen).
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(labels.first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto(`/c/bewohner/zimmer/${room.id}`);
  await page.waitForURL(`**/c/bewohner?resident=${resident.id}`);
  await expect(page.getByRole("heading", { name: resident.name }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("QR-Code am Zimmer: ohne Anmeldung zuerst anmelden, danach das Zimmer", async ({ page }) => {
  const response = await page.goto("/c/bewohner/zimmer/00000000-0000-4000-8000-000000000000");
  expect(response?.ok()).toBe(true);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/c/bewohner/zimmer/00000000-0000-4000-8000-000000000000");
});
