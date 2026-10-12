import { defineConfig, devices } from "@playwright/test";

// Klicktests gegen die gebaute App (`next build` vorher). Die Datenbankanfragen des Neon-Treibers beantwortet
// eine echte Postgres (TEST_DATABASE_URL, siehe tests/support/neon-pg.mjs), vorbereitet mit `npm run test:e2e:setup`.
const port = Number(process.env.E2E_PORT ?? 3200);
// Nur für die Testdatenbank; in CI und lokal ohne Geheimnis.
export const E2E_ADMIN_PASSWORD = "E2E-Admin-Passwort-2026";
// Schlüssel für die Zwei-Faktor-Anmeldung, nur für die Klicktests (32 Bytes, Base64).
export const E2E_MFA_KEY = Buffer.alloc(32, 42).toString("base64");
// Port des Test-Anbieters für SSO.
export const E2E_OIDC_PORT = Number(process.env.E2E_OIDC_PORT ?? 3299);
// Test-Mailserver: SMTP auf diesem Port, empfangene Nachrichten per HTTP auf Port + 1.
export const E2E_SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 3297);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1440, height: 950 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 950 } } }],
  webServer: [
    {
      command: `npx next start -p ${port}`,
      url: `http://localhost:${port}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_OPTIONS: "--import ./tests/support/neon-pg.mjs",
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
        CARECORE_ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
        CARECORE_MFA_KEY: E2E_MFA_KEY,
        // SSO gegen den lokalen Test-Anbieter (http nur für localhost).
        CARECORE_SSO_ALLOW_HTTP: "1",
        // E-Mail-Versand an den Test-Mailserver; Links zeigen auf die Test-App.
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(E2E_SMTP_PORT),
        MAIL_FROM: "CareOS <noreply@carecore.test>",
        APP_URL: `http://localhost:${port}`,
      },
    },
    {
      // Test-Anbieter für SSO (OpenID Connect), siehe tests/support/mock-oidc.mjs.
      command: `node tests/support/mock-oidc.mjs ${E2E_OIDC_PORT}`,
      url: `http://localhost:${E2E_OIDC_PORT}/.well-known/openid-configuration`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Test-Mailserver, siehe tests/support/mock-smtp.mjs.
      command: `node tests/support/mock-smtp.mjs ${E2E_SMTP_PORT}`,
      url: `http://127.0.0.1:${E2E_SMTP_PORT + 1}/messages`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
