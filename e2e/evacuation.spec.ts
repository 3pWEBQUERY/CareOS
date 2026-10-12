import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";
import type { OccupancyOverview } from "../lib/occupancy-shared";

// Evakuierungs- und Notfallliste: Mobilität im Notfall in den Stammdaten, gedruckt je Wohnbereich mit Stand.
test("Evakuierungsliste: Mobilität erfassen, Liste je Wohnbereich mit Zimmer, Hinweisen und Stand", async ({
  page,
}) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const overview = (await (await page.request.get("/api/occupancy")).json()) as OccupancyOverview;
  const unit = overview.units.find((item) =>
    item.rooms.some((room) => room.occupants.some((person) => person.status === "active")),
  )!;
  const room = unit.rooms.find((item) => item.occupants.some((person) => person.status === "active"))!;
  const resident = room.occupants.find((person) => person.status === "active")!;

  await page.goto(`/c/bewohner?resident=${resident.id}`);
  await page.locator(".resident-record-tabs button", { hasText: "Stammdaten" }).click();
  await page.getByRole("button", { name: "Stammdaten bearbeiten" }).click();
  const card = page.getByRole("region", { name: "Brandfall & Evakuation" });
  await card.getByRole("combobox", { name: "Mobilität im Notfall" }).click();
  await page.getByRole("option", { name: "Rollstuhl" }).click();
  await card.getByLabel("Hinweise für den Notfall").fill("Sauerstoff 2 l/min");
  await page.getByRole("button", { name: "Stammdaten speichern" }).click();
  await expect(page.getByRole("button", { name: "Stammdaten bearbeiten" })).toBeVisible();

  await page.goto("/c/bewohner/belegung");
  const link = page.getByRole("link", { name: `Evakuierungsliste ${unit.name} drucken` });
  await expect(link).toHaveAttribute("href", `/c/bewohner/belegung/evakuierung?unit=${unit.id}`);

  await page.goto(`/c/bewohner/belegung/evakuierung?unit=${unit.id}&dialog=0`);
  const sheet = page.getByRole("article", { name: `Evakuierungsliste ${unit.name}` });
  await expect(sheet.getByRole("heading", { level: 1 })).toContainText(`Evakuierungsliste · ${unit.name}`);
  await expect(sheet).toContainText(/Stand: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
  const row = sheet.locator("tbody tr", { hasText: "Sauerstoff 2 l/min" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Rollstuhl");
  await expect(row).toContainText("REA:");
  expect(errors).toEqual([]);
});
