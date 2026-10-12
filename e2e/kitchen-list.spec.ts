import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";
import type { KitchenList } from "../lib/kitchen-list-shared";

// Küchenliste: aus dem Ernährungsplan je Wohnbereich, mit Stand.
test("Küchenliste: Link im Ernährungsplan, Liste je Wohnbereich mit Kostform und Stand", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const list = (await (await page.request.get("/api/nutrition/kitchen-list")).json()) as KitchenList;
  const unit = list.units.find((item) => item.people.length > 0)!;
  await page.goto("/c/ernaehrung");
  await expect(page.getByRole("link", { name: `Küchenliste ${unit.name} drucken` })).toHaveAttribute(
    "href",
    `/c/ernaehrung/kuechenliste?unit=${unit.id}`,
  );
  await page.goto(`/c/ernaehrung/kuechenliste?unit=${unit.id}&dialog=0`);
  const sheet = page.getByRole("article", { name: `Küchenliste ${unit.name}` });
  await expect(sheet.getByRole("heading", { level: 1 })).toContainText(`Küchenliste · ${unit.name}`);
  await expect(sheet).toContainText(/Stand: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/);
  await expect(sheet.locator("tbody tr")).toHaveCount(unit.people.length);
  expect(errors).toEqual([]);
});
