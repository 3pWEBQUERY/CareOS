import { expect, test } from "@playwright/test";
import { ADMIN, FAGE, field, login, watchErrors } from "./support";

// Schulung mit Quiz anlegen (Leitung), Quiz ablegen (Mitarbeitende) und die Übersicht je Team prüfen.
test("Lernen: Quiz mit Bestehensgrenze und Pflichtnachweise je Team", async ({ page }) => {
  const title = `E2E Händehygiene ${Date.now()}`;
  await login(page, ADMIN);
  let errors = watchErrors(page);
  await page.goto("/personal/schulungen");
  await page.getByRole("button", { name: "Schulung anlegen" }).click();
  const editor = page.locator(".editor-dialog");
  await field(page, "Titel").fill(title);
  await editor.getByLabel("Pflichtnachweis", { exact: true }).check();
  await editor.getByLabel("Quiz verlangen").check();
  await field(page, "Bestehensgrenze").fill("100");
  await field(page, "Frage 1").fill("Wie lange werden die Hände desinfiziert?");
  await editor.getByLabel("Frage 1, Antwort 1").fill("5 Sekunden");
  await editor.getByLabel("Frage 1, Antwort 2").fill("30 Sekunden");
  await editor.getByLabel("Antwort 2 ist richtig").check();
  await editor.getByRole("button", { name: "Anlegen", exact: true }).click();
  await expect(page.locator(".toast")).toContainText(`„${title}“ angelegt`);
  expect(errors).toEqual([]);

  await page.context().clearCookies();
  await login(page, FAGE);
  errors = watchErrors(page);
  const learning = (await (await page.request.get("/api/learning")).json()) as {
    trainings: Array<{ id: string; title: string; quiz: { questions: Array<{ correct: number | null }> } | null }>;
  };
  const training = learning.trainings.find((t) => t.title === title)!;
  // Die richtige Antwort geht nicht an Mitarbeitende.
  expect(training.quiz?.questions[0].correct).toBeNull();
  expect((await page.request.post("/api/learning/enrollments", { data: { trainingId: training.id } })).status()).toBe(
    201,
  );

  await page.goto("/personal/schulungen");
  await page.locator(".learning-course", { hasText: title }).click();
  await page.locator(".learning-focus").getByRole("button", { name: "Quiz starten" }).click();
  const quiz = page.locator(".editor-dialog", { hasText: "bestanden ab 100 %" });
  await quiz.getByLabel("5 Sekunden").check();
  await quiz.getByRole("button", { name: "Auswerten", exact: true }).click();
  await expect(quiz.locator(".learning-quiz-result")).toContainText("Nicht bestanden: 0 von 1 richtig (0 %)");
  await quiz.getByLabel("30 Sekunden").check();
  await quiz.getByRole("button", { name: "Erneut auswerten" }).click();
  await expect(page.locator(".toast")).toContainText("Quiz bestanden (100 %)");
  await expect(page.locator(".learning-focus")).toContainText("Quiz bestanden (100 %)");
  expect(errors).toEqual([]);

  await page.context().clearCookies();
  await login(page, ADMIN);
  errors = watchErrors(page);
  await page.goto("/personal/schulungen/pflichtnachweise");
  await page.getByRole("button", { name: "Person", exact: true }).click();
  await page.getByRole("option", { name: "Alle Mitarbeitenden" }).click();
  const teams = page.getByRole("group", { name: "Übersicht je Team" });
  await expect(teams.locator(".learning-team").first()).toBeVisible();
  const first = teams.locator(".learning-team").first();
  const teamName = (await first.locator("strong").innerText()).trim();
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".learning-catalog-card .card-subtitle")).toContainText("Nachweise");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "false");
  expect(teamName.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
