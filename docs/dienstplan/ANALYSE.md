# Dienstplan-Modul – Analyse (Phase 0)

Stand: 27.09.2026. Grundlage: `docs/specs/dienstplan.md`.

## Stack und Versionen (aus `package.json`)

| Bereich       | Im Projekt                                                                                                                                                                         | Folge für die Spec                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | Next.js 16.3.4 (App Router), React 19.2.8                                                                                                                                          | `proxy.ts` statt `middleware.ts`, `params` asynchron, `after()` aus `next/server` für Arbeit nach der Antwort                             |
| Datenbank     | Neon Postgres über `@neondatabase/serverless` (HTTP), **kein Prisma**                                                                                                              | Nummerierte SQL-Migrationen in `database/migrations`, angewendet durch `database/migrate.mjs` (auf Vercel nur bei Production-Deployments) |
| Transaktionen | `sql.transaction([...])` = nicht-interaktiver Batch in einer Transaktion                                                                                                           | Kein `SELECT … FOR UPDATE` über mehrere Roundtrips; Nebenläufigkeit über Versionsprüfung in einzelnen SQL-Anweisungen plus DB-Constraints |
| Validierung   | Handgeschriebene Prüfungen, **kein Zod**                                                                                                                                           | Schemas in `lib/roster/schemas.ts` als Funktionen                                                                                         |
| UI            | Eigene Komponenten (`app/components/*`, `workspace-ui.tsx`, `care-form-controls.tsx`), CSS-Dateien in `app/styles`, Icons `@phosphor-icons/react`, **kein shadcn/ui, kein Lucide** | Bestehende Komponenten und Muster; Seitenpanels rechts (70 %) für Dialoge                                                                 |
| Tests         | `node --test` mit TypeScript-Type-Stripping (`tests/*.test.ts`)                                                                                                                    | Unit-Tests für reine Funktionen; DB-Integrationstests neu mit echtem Postgres                                                             |
| KI            | `@anthropic-ai/sdk` (CareOS KI)                                                                                                                                                    | Dienstplan-KI laut Entscheid mit Mistral (`@mistralai/mistralai`)                                                                         |
| Drag & Drop   | keine Library                                                                                                                                                                      | `@dnd-kit/core` (siehe DECISIONS)                                                                                                         |
| Realtime/Jobs | keine Queue, kein Cron; Erinnerungen werden beim Laden der Benachrichtigungen erzeugt                                                                                              | Polling-Route für Änderungen, Prüfungen (fehlender Clock-out) beim Laden, KI-Läufe mit `after()`                                          |

## Auth und Session

- Sitzungen in `carecore_sessions` (Cookie, gehashter Token), `lib/auth.ts`.
- `carecoreActor()` (`lib/server-data.ts`) liefert Person, Organisation und Berechtigungen der Rolle.
- `apiContext(permission)` (`lib/api-context.ts`) prüft Anmeldung, Organisation und eine Berechtigung; Route Handler nutzen es konsequent.
- Mutationen laufen als **Route Handler** (`app/api/**/route.ts`), nicht als Server Actions.

## Rollen und Berechtigungen

- Tabelle `carecore_roles` mit JSON-Liste von Berechtigungen, editierbar unter „Mitarbeitende & Dienste › Profile & Rollen“.
- Vorhandene Schlüssel: `residents.read`, `residents.write`, `documentation.write`, `medication.manage`, `schedule.manage`, `team.manage`, `quality.manage`, `insights.read`, `administration.manage`, `rai.manage`, `ai.use`.
- Bisher kein Scope pro Wohnbereich: `schedule.manage` gilt organisationsweit.

## Organisationsstruktur

`carecore_organizations` (mit `timezone`, Default `Europe/Zurich`) → `carecore_sites` (Einrichtung) → `carecore_care_units` (Wohnbereich = Wohngruppe der Spec). Personen: `carecore_users` + `carecore_user_profiles` (`organization_id`, `primary_care_unit_id`, `job_title`). Personen werden archiviert, können von der Administration aber auch gelöscht werden (`lib/admin-users.ts`, `app/api/teamlead/employees`).

## Navigation

`app/components/navigation.ts`: Gruppen → Module → Reiter; die Adresse bestimmt Modul und Reiter (`activePage`). Sidebar (`app-sidebar.tsx`) und Mobilmenü (`mobile-navigation.tsx`) filtern nach Berechtigungen. Bisher: „Mein Dienst › Dienstplan“ (Mein Dienstplan, Teamplanung) und „Leitung › Mitarbeitende & Dienste › Dienste“.

## Benachrichtigungen

`carecore_notifications` (user_id, title, body, type, priority, link_url, read_at). Glocke mit Zähler und „alle gelesen“ im Header (`header-notification-menu.tsx`), Kategorien abschaltbar in den persönlichen Einstellungen.

## Audit

`carecore_audit_log` (entity_type, entity_id, action, before/after, Fremdschlüssel mit `ON DELETE SET NULL`) wird von vielen Modulen genutzt und ist nicht append-only.

## Bestehendes Dienstplan-Modul (wird ersetzt)

| Teil                                            | Dateien                                                                                                     | Modell                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Dienstplan (Mein Dienstplan, Teamplanung)       | `app/betrieb/dienstplanung`, `app/betrieb/components/schedule-*`, `lib/schedule*.ts`, `app/api/schedule/**` | `carecore_shifts` (Dienst-Slot pro Wohnbereich/Zeit mit `required_staff`) + `carecore_shift_assignments` (Personen im Slot) |
| Abwesenheiten                                   | `lib/schedule-absences.ts`, `carecore_absences`                                                             | Antrag Ferien/Krankheit/Weiterbildung/persönlich mit Bewilligung                                                            |
| Teamleitung › Dienste                           | `app/leitung/teamleitung/dienste`, `app/api/teamlead/shifts`                                                | einfache Liste auf `carecore_shifts`                                                                                        |
| Mein Dienst (Check-in/Check-out, Verlauf, Puls) | `lib/shift*.ts`, `app/api/shift/**`                                                                         | Check-in auf Einteilungen in `carecore_shift_assignments`, Checkliste, Übergabestatus                                       |
| Weitere Leser                                   | `lib/handover.ts` (letztes Dienstende), `lib/team-news.ts`                                                  | lesen `carecore_shifts`                                                                                                     |

Das Slot-Modell passt nicht zur Spec (Dienst = Person × Tag, Periode mit Entwurf/Veröffentlichung, Overlap-Constraint pro Person). Entscheid der Produktverantwortung: **das neue Modul ersetzt das alte**.

## Mapping Spec → bestehend/neu

| Spec                                                                                                | Umsetzung                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| User, Rollen                                                                                        | bestehend (`carecore_users`, `carecore_roles`)                                                                                        |
| Wohngruppe                                                                                          | bestehend (`carecore_care_units`)                                                                                                     |
| EmployeeProfile                                                                                     | neu `carecore_employee_profiles` (1:1 zu User); Stammwohnbereich bleibt `carecore_user_profiles.primary_care_unit_id`                 |
| Wohngruppen-Zugehörigkeit / Leitung pro Wohngruppe                                                  | neu `carecore_unit_memberships` (Rolle `member` oder `lead`)                                                                          |
| Qualification, EmployeeQualification                                                                | neu                                                                                                                                   |
| ShiftType, StaffingRequirement, SchedulePeriod                                                      | neu                                                                                                                                   |
| Shift                                                                                               | neu `carecore_roster_shifts` (ersetzt `carecore_shifts`/`carecore_shift_assignments`)                                                 |
| Abwesenheiten (Urlaub, Krank, Fortbildung)                                                          | Diensttypen der Kategorie ABSENCE; der bestehende Antrag `carecore_absences` wird angebunden: Bewilligung erzeugt Abwesenheitsdienste |
| TimeOffRequest (Wunschfrei)                                                                         | neu `carecore_time_off_requests`                                                                                                      |
| ShiftPreference, ShiftSwap, TimeEntry, TimeCorrectionRequest, PublicHoliday, RuleSet, AiPlanningRun | neu                                                                                                                                   |
| Notification                                                                                        | bestehend, erweitert um `entity_type`, `entity_id`                                                                                    |
| AuditLog (append-only)                                                                              | neu `carecore_roster_audit` mit Trigger; das bestehende `carecore_audit_log` bleibt für andere Module                                 |

## Risiken

- **Keine interaktiven Transaktionen** (Neon HTTP): Tausch und Verschieben werden als einzelne SQL-Anweisungen mit Versions- und Fingerabdruckprüfung geschrieben. Der Overlap-Constraint ist `DEFERRABLE` und fängt Überschneidungen zusätzlich ab.
- **`btree_gist`** wird für den Overlap-Constraint gebraucht; Neon unterstützt die Extension.
- **Migration auf Production** läuft beim Deployment von `main`; alle Änderungen sind additiv.
- **Löschen von Personen** mit Dienstplan-Daten wird verhindert (Fremdschlüssel `RESTRICT`), Archivieren bleibt möglich.
- **Mistral-Key** fehlt bis zur Hinterlegung in Vercel; die KI-Funktionen sind bis dahin mit Hinweis deaktiviert.
- **Hintergrundjobs** gibt es nicht; fehlender Clock-out wird beim Laden von Dienstplan, Zeiterfassung und Benachrichtigungen geprüft.

## Offene Fragen aus Abschnitt 15

| Nr. | Frage                       | Antwort / Entscheid                                                                                    |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Rechtsraum                  | **Schweiz (ArG)** – bestätigt. Werte als Beispielwerte, „rechtlich prüfen“                             |
| 2   | Sichtbarkeit                | **Teamplan der Wohngruppe** – bestätigt; Abwesenheiten anderer nur als „Abwesend“                      |
| 3   | Übernahme ohne Gegendienst  | Default nein (`allowShiftTakeover = false`), im Regelwerk einschaltbar                                 |
| 4   | Genehmigtes Wunschfrei hart | Default ja                                                                                             |
| 5   | Pausen                      | Default pauschal aus Diensttyp; Pause starten/beenden optional                                         |
| 6   | Einstempeln                 | nur im Browser                                                                                         |
| 7   | Springer                    | ja, über Mitgliedschaft in mehreren Wohnbereichen; geplant von der Leitung des jeweiligen Wohnbereichs |
| 8   | Stellvertretende Leitung    | über Leitungs-Mitgliedschaft im Wohnbereich + Rolle mit `schedule.manage`                              |
| 9   | Regelwerk/Diensttypen       | organisationsweit: Administration (`administration.manage`); pro Wohnbereich: dessen Leitung           |
| 10  | UI-Locale                   | de-CH (aus `carecore_user_profiles.locale`, Default `de-CH`)                                           |
| 11  | Realtime/Jobs               | keine vorhanden → Polling, Prüfung beim Laden, `after()` für KI                                        |
