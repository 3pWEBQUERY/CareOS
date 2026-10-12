import { expect, test } from "@playwright/test";
import { ADMIN, login, watchErrors } from "./support";

const MARIA = "00000000-0000-4000-8000-000000000402";

// Trendhinweis Gewicht: erscheint erst, wenn die Einrichtung Grenze und Zeitraum festlegt.
test("Ernährung: Trendhinweis nach der Grenze der Einrichtung", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const setting = (key: string, body: Record<string, unknown>) =>
    page.request.patch(`/api/settings/${key}`, { data: body });
  const weigh = async (kg: number, daysAgo: number) =>
    expect(
      (
        await page.request.post("/api/vitals/measurements", {
          data: {
            residentId: MARIA,
            values: { Gewicht: { value: kg } },
            measuredAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
          },
        })
      ).status(),
    ).toBeLessThan(300);
  await weigh(62, 6);
  await weigh(58, 0);

  await page.goto("/c/ernaehrung/trinkprotokoll");
  const row = page.locator(".fluids-table button", { hasText: "Maria" });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Trendhinweis");

  try {
    expect((await setting("weightLossPercent", { enabled: true, value: 5 })).status()).toBe(200);
    expect((await setting("weightLossDays", { enabled: true, value: 7 })).status()).toBe(200);
    await page.reload();
    await expect(row).toContainText("Trendhinweis");
    await row.click();
    await expect(page.getByRole("status", { name: "Trendhinweise Ernährung" })).toContainText(
      /Gewichtsverlust 4 kg \(6\.5 %\) in 7 Tagen – Grenze 5 %/,
    );
  } finally {
    expect((await setting("weightLossPercent", { enabled: false })).status()).toBe(200);
    expect((await setting("weightLossDays", { enabled: false })).status()).toBe(200);
  }
  expect(errors).toEqual([]);
});
