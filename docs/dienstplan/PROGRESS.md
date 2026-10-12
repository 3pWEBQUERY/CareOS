# Dienstplan-Modul – Fortschritt

| Phase                                          | Status   | Nachweis                                                                                                          |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| 0 – Analyse                                    | erledigt | `ANALYSE.md`, `DECISIONS.md`; offene Fragen 1, 2 und KI-Anbieter bestätigt                                        |
| 1 – Fundament                                  | erledigt | Migration 0023 (frische DB und DB mit Altdaten), DB-Tests `tests/db/constraints.test.ts`, Seed zweimal fehlerfrei |
| 2 – Regel-Engine & Zeit                        | erledigt | `lib/roster/{time,rules,worktime,permissions}.ts`, Tests `tests/roster-*.test.ts`                                 |
| 3 – Dienstplan Leitung                         | erledigt | Raster mit DnD, Publish/Revert, Einstellungen, Protokoll; `tests/db/schedule.test.ts`; Browsertest                |
| 4 – Mein Dienstplan, Wunschfrei, Dienstwünsche | erledigt | `/c/mein-dienstplan` (+ Teamplan, Anträge); `tests/db/requests.test.ts`; Browsertest                              |
| 5 – Diensttausch                               | erledigt | Kandidaten, Annahme, Genehmigung, Nebenläufigkeit; `tests/db/swaps.test.ts`; Browsertest                          |
| 6 – Zeiterfassung & Auswertung                 | erledigt | Stempeln/Pause, Korrekturen, Soll/Ist, Monatsabschluss, Mein Dienst angebunden; Browsertest                       |
| 7 – KI (Mistral)                               | erledigt | `tests/roster-ai.test.ts`, `tests/db/ai.test.ts` (Test-Double); Lauf mit echtem Schlüssel steht aus               |
| 8 – Aktualisierung, Feinschliff, Abnahme       | erledigt | Polling, Mobile ohne Querscrollen, README-Abschnitt, alle Checks grün                                             |

## Checks

```bash
npm run format:check && npm run lint && npx tsc --noEmit
npm test                                   # Unit-Tests (ohne Datenbank)
TEST_DATABASE_URL=postgres://… npm run test:db:setup   # Migrationen auf leerer Test-DB
TEST_DATABASE_URL=postgres://… npm run test:db:seed    # Seed (zweimal ausführbar)
TEST_DATABASE_URL=postgres://… npm run test:db         # Integrationstests gegen Postgres
npx next build
```
