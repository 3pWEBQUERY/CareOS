import { expect, test } from "@playwright/test";
import { ADMIN, login } from "./support";

// Tippflächen mindestens 24 × 24 px (WCAG 2.2, 2.5.8 Zielgrösse Minimum), auf dem Handy und am Computer.
const PAGES: Array<[string, string, boolean]> = [
  // [Seite, Auswahl, muss vorhanden sein]
  ["/c/pflegedokumentation/visite", ".visit-resident h3 a", true],
  ["/c/pflegedokumentation/nachweis", ".proof-resident h2 a", false],
  ["/c/alltag/teilnahme", ".participation-report .services-report-table td > a", true],
  ["/c", ".home-news-foot button", true],
  ["/c", ".home-notes-empty button", false],
  ["/c/betrieb/uebergabe", ".handover-event-list article > button", false],
  ["/c/leitung/teamleitung/aufgaben", ".teamlead-task-card button", true],
];

for (const [device, width, height] of [
  ["Handy", 390, 844],
  ["Computer", 1440, 1000],
] as const)
  test(`Tippflächen (${device}): kleine Links und Textknöpfe mindestens 24 px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await login(page, ADMIN);
    for (const [url, selector, required] of PAGES) {
      await page.goto(url);
      const targets = page.locator(selector);
      if (required) await expect(targets.first()).toBeVisible();
      const count = await targets.count();
      for (let index = 0; index < count; index += 1) {
        const box = await targets.nth(index).boundingBox();
        if (!box) continue;
        const label = `${url} ${selector}: ${(await targets.nth(index).textContent())?.trim()}`;
        expect(box.height, label).toBeGreaterThanOrEqual(24);
        expect(box.width, label).toBeGreaterThanOrEqual(24);
      }
    }
  });
