import { expect, test } from "@playwright/test";
import { FAGE, login, watchErrors } from "./support";

// Startseite: alle Bausteine (auch Meine Apps, Notizen, Heute wichtig und Neuigkeiten) lassen sich verschieben,
// in der Breite ändern, zwischen Kopf- und Hauptbereich wechseln und ausblenden; das Layout bleibt nach dem Neuladen.
test("Arbeitsplatz: alle Bausteine verschieben, Breite und Bereich wählen, ausblenden, gespeichert", async ({
  page,
}) => {
  await login(page, FAGE);
  // Ausgangslage: Standard-Layout (auch nach einem abgebrochenen Lauf).
  await page.request.delete("/api/dashboard/layout");
  const errors = watchErrors(page);
  await page.goto("/c");
  const top = page.locator(".home-desk-grid.dashboard-area");
  const main = page.locator(".dashboard-custom-grid.dashboard-area");
  const ids = (area: typeof top) =>
    area
      .locator(":scope > .dashboard-widget")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-widget")));

  // Standard: Begrüssung und die drei Karten im Kopfbereich, Neuigkeiten zuerst im Hauptbereich.
  await expect.poll(() => ids(top)).toEqual(["greeting", "shortcuts", "notes", "today"]);
  expect((await ids(main))[0]).toBe("news");

  await page.getByRole("button", { name: "Startseite anpassen" }).click();
  // Notizen nach hinten, dann in den Hauptbereich und auf halbe Breite.
  await page.getByRole("button", { name: "Meine Notizen nach hinten" }).click();
  await expect.poll(() => ids(top)).toEqual(["greeting", "shortcuts", "today", "notes"]);
  await page.getByRole("button", { name: "Meine Notizen in Hauptbereich" }).click();
  await expect.poll(() => ids(top)).toEqual(["greeting", "shortcuts", "today"]);
  expect(await ids(main)).toContain("notes");
  // Breite über das eigene Dropdown (kein Browser-Select).
  await page.getByRole("combobox", { name: "Breite von Meine Notizen" }).click();
  await page.getByRole("option", { name: "½" }).click();
  await expect(main.locator('[data-widget="notes"]')).toHaveClass(/span-6/);
  // Neuigkeiten in den Kopfbereich, Meine Apps ausblenden, Begrüssung in den Hauptbereich.
  await page.getByRole("button", { name: /Neuigkeiten in Kopfbereich/ }).click();
  await page.getByRole("button", { name: "Meine Apps ausblenden" }).click();
  await page.getByRole("button", { name: "Begrüssung in Hauptbereich" }).click();
  await expect.poll(() => ids(top)).toEqual(["today", "news"]);
  expect(await ids(main)).toContain("greeting");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Guten (Morgen|Tag|Abend), /);
  await page.getByRole("button", { name: "Fertig" }).click();

  // Nach dem Neuladen (Layout aus der Datenbank) bleibt alles so – erst nachdem alles gespeichert ist.
  const saved = async () => {
    const { layout } = (await (await page.request.get("/api/dashboard/layout")).json()) as {
      layout: { top: string[]; hidden: string[] };
    };
    return layout.top.filter((id) => !layout.hidden.includes(id));
  };
  await expect.poll(saved).toEqual(["today", "news"]);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect.poll(() => ids(top)).toEqual(["today", "news"]);
  await expect(main.locator('[data-widget="notes"]')).toHaveClass(/span-6/);
  await expect(main.locator('[data-widget="greeting"]')).toBeVisible();
  await expect(page.locator(".home-shortcuts")).toHaveCount(0);

  // Standard wiederherstellen.
  await page.getByRole("button", { name: "Startseite anpassen" }).click();
  await page.getByRole("button", { name: "Standard wiederherstellen" }).click();
  await expect.poll(() => ids(top)).toEqual(["greeting", "shortcuts", "notes", "today"]);
  expect(errors).toEqual([]);
});
