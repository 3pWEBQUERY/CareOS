import { expect, test } from "@playwright/test";
import { ADMIN, field, login, watchErrors } from "./support";

// Aufgaben abschliessen mit Ergebnis (✓ △ ✕) und an die Leitung eskalieren.
test("Aufgaben: teilweise erledigt abschliessen und eine Aufgabe eskalieren", async ({ page }) => {
  await login(page, ADMIN);
  const errors = watchErrors(page);
  const stamp = Date.now();
  const create = async (title: string) => {
    const response = await page.request.post("/api/tasks", {
      data: { title, category: "Pflege", teamVisible: true },
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  const partialId = await create(`E2E Grundpflege ${stamp}`);
  const escalateId = await create(`E2E Verbandwechsel ${stamp}`);

  await page.goto(`/c/betrieb/aufgaben/team?task=${partialId}`);
  const detail = page.locator(".editor-dialog");
  await detail.getByRole("button", { name: "Abschliessen", exact: true }).click();
  const outcome = page.locator(".editor-dialog", { hasText: "Ergebnis" });
  await outcome.getByRole("button", { name: /Teilweise/ }).click();
  await expect(outcome.getByRole("button", { name: /Teilweise/ })).toHaveAttribute("aria-pressed", "true");
  await field(page, "Was wurde erledigt").fill("Haarwäsche abgelehnt");
  await outcome.getByRole("button", { name: "Abschliessen", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("teilweise erledigt");

  await page.goto(`/c/betrieb/aufgaben/team?task=${escalateId}`);
  await detail.getByRole("button", { name: "Eskalieren", exact: true }).click();
  await field(page, "Grund").fill("Verbandmaterial fehlt");
  await page.locator(".editor-dialog").getByRole("button", { name: "Eskalieren", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("eskaliert");

  const list = (await (await page.request.get("/api/tasks?scope=team")).json()) as {
    tasks: Array<{ id: string; status: string; completionNote: string | null; escalationReason: string | null }>;
  };
  const partial = list.tasks.find((task) => task.id === partialId);
  const escalated = list.tasks.find((task) => task.id === escalateId);
  expect(partial?.status).toBe("partial");
  expect(partial?.completionNote).toBe("Haarwäsche abgelehnt");
  expect(escalated?.status).toBe("escalated");
  expect(escalated?.escalationReason).toBe("Verbandmaterial fehlt");

  // In der Liste: Filter „Eskaliert“ zeigt die Aufgabe mit rotem Status.
  await page.getByRole("button", { name: "Eskaliert", exact: true }).click();
  const row = page.locator(".task-row", { hasText: `E2E Verbandwechsel ${stamp}` });
  await expect(row.locator(".status-badge")).toHaveText("Eskaliert");
  await expect(row.locator(".status-badge")).toHaveClass(/critical/);
  expect(errors).toEqual([]);
});
