# CareOS – Modul Dienstplan, Diensttausch, Wunschfrei, KI-Planung & Zeiterfassung

> Spezifikation für Claude Code. Ablage im Repo: `docs/specs/dienstplan.md`.
> Diese Datei ist die fachliche Source of Truth. Abschnitt 0 regelt, **wie** gearbeitet wird, und ist verbindlich.

---

## 0. Arbeitsweise (zuerst lesen, verbindlich)

### 0.1 Phasen statt Big Bang

Implementiere strikt in den Phasen aus **Abschnitt 14**. Nach jeder Phase:

1. alle Checks aus 0.7 ausführen,
2. `docs/dienstplan/PROGRESS.md` aktualisieren,
3. committen (eine Phase = mindestens ein Commit, sprechende Message),
4. **STOPP** – Abschlussbericht (0.6) ausgeben und auf Freigabe warten.

Beginne nie mit der nächsten Phase ohne ausdrückliche Freigabe.

### 0.2 Was gilt bei Widersprüchen

- **Technik** (Ordnerstruktur, Namen, Libraries, Auth, UI-Komponenten, Notification-System): der **bestehende CareOS-Code** gewinnt gegen diese Spec.
- **Fachliche Regeln** (Validierung, Berechtigungen, Tausch-Ablauf, Zeitberechnung): **diese Spec** gewinnt.
- Jede Abweichung von der Spec wird in `docs/dienstplan/DECISIONS.md` mit Begründung festgehalten.

### 0.3 Versionen nicht raten

Lies `package.json` und nutze die Konventionen der **installierten** Versionen von Next.js, React, Prisma, Zod, shadcn/ui. Nicht aus Trainingswissen annehmen. Beispiele, die du prüfen musst:

- Next.js 16: `proxy.ts` statt `middleware.ts`, asynchrone `params`/`searchParams`, aktuelles Caching-Modell.
- Prisma: Die Major-Version bestimmt Konfiguration (`prisma.config.ts`, Generator-Output, Driver Adapter). Richte dich nach dem, was im Projekt steht.
- Im Zweifel die Doku/Typen in `node_modules` lesen statt zu raten.

Neue Dependencies nur mit Begründung in DECISIONS.md. Vorhandene Libraries (Datum, Formulare, Tabellen, DnD) bevorzugen.

### 0.4 Verboten

- `prisma migrate reset`, `prisma db push`, `--accept-data-loss` oder sonstige destruktive Befehle gegen eine **nicht-lokale** Datenbank. Keinerlei Befehle gegen die Railway-Produktions-DB. Arbeite ausschließlich mit lokaler/Dev-DB.
- Bereits angewendete Migrationen verändern.
- Werte aus `.env` ausgeben, loggen oder committen.
- `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip`/`.only`, gelöschte oder abgeschwächte Tests, um Checks grün zu bekommen.
- Mock- oder Platzhalterdaten in der UI (hartkodierte Arrays, Fake-Statistiken). Test-Doubles **in Tests** sind erlaubt.
- `TODO`/Stub-Code in Features, die als fertig gemeldet werden.
- Arbeitsrechtliche Grenzwerte erfinden (siehe Abschnitt 4).

### 0.5 Wann fragen, wann entscheiden

- Kleine technische Fragen: sinnvoll entscheiden, in DECISIONS.md dokumentieren.
- Fachliche, rechtliche oder sicherheitsrelevante Fragen: **fragen**, nicht raten. Offene Punkte stehen in Abschnitt 15.

### 0.6 Abschlussbericht je Phase

Ehrlich und konkret:

- Was funktioniert – und **wie verifiziert** (Test, manueller Ablauf, Befehl).
- Was nicht getestet ist.
- Bekannte Lücken, Risiken, Annahmen.
- Nächste Phase und was dafür offen ist.

„Fertig“ darf nur gemeldet werden, wenn die DoD der Phase vollständig erfüllt ist.

### 0.7 Checks (Script-Namen aus `package.json` verwenden)

```bash
<pm> tsc --noEmit            # 0 Fehler
<pm> lint                    # 0 Fehler, keine neuen Warnungen
<pm> test                    # alle grün
npx prisma migrate dev       # auf frischer lokaler DB fehlerfrei
npx prisma db seed           # zweimal hintereinander fehlerfrei (idempotent)
<pm> build                   # Production-Build erfolgreich
```

---

## 1. Ziel und Scope

CareOS erhält ein vollständig integriertes Modul für Pflege-/Wohngruppen: Dienstplanung (Raster, Drag & Drop, Entwurf/Veröffentlichung), Diensttypen und Mindestbesetzung, Wunschfrei, Dienstwünsche, Diensttausch (automatisch oder mit Genehmigung), KI-gestützte Planung und Analyse (Mistral), Zeiterfassung mit Soll/Ist-Auswertung, Benachrichtigungen und ein unveränderliches Audit-Log.

Produktionsnah: Datenbank, Server-Logik, Berechtigungen, Validierung und UI sind verbunden. Alle Daten liegen in PostgreSQL.

**Nicht im Scope** (nur umsetzen, wenn ausdrücklich freigegeben):

- Lohnexport, Zuschlagsberechnung in Geldbeträgen
- E-Mail/Push-Versand (außer CareOS hat das bereits – dann anbinden)
- Stempelterminals, Geofencing, native Apps
- Automatischer Feiertagsimport per externer API (Feiertage werden gepflegt/geseedet)

---

## 2. Glossar, Namen, Klarstellungen

### 2.1 Glossar

| UI (Deutsch)              | Code (Englisch)        | Bemerkung                                               |
| ------------------------- | ---------------------- | ------------------------------------------------------- |
| Dienstplan (eines Monats) | `SchedulePeriod`       | pro Wohngruppe und Monat, Status Entwurf/Veröffentlicht |
| Dienst                    | `Shift`                | konkreter Eintrag Person × Tag                          |
| Diensttyp                 | `ShiftType`            | Früh, Spät, Nacht, Urlaub …                             |
| Wohngruppe                | bestehende Org-Einheit | **nicht neu anlegen**, falls vorhanden                  |
| Diensttausch              | `ShiftSwap`            |                                                         |
| Wunschfrei                | `TimeOffRequest`       |                                                         |
| Dienstwunsch              | `ShiftPreference`      |                                                         |
| Zeiteintrag               | `TimeEntry`            |                                                         |
| Leitung / Mitarbeitende   | bestehende Rollen      |                                                         |

Konvention: Code, Typen, DB-Modelle und Funktionsnamen auf Englisch; UI-Texte, Fehlermeldungen und Routen (`/dienstplan`, `/mein-dienstplan`) auf Deutsch. Bestehende CareOS-Konventionen (z. B. `@@map` auf snake_case) übernehmen.

### 2.2 Klarstellungen gegenüber der ursprünglichen Anforderung

1. **Differenz = Netto-Ist minus Netto-Soll.** Beispiel: Soll 06:30–15:00 mit 30 Min Pause = 480 Min; Ist 06:42–15:18 mit 30 Min Pause = 486 Min → **Differenz +6 Min**. Zusätzlich werden Beginn-Abweichung (+12 Min) und Ende-Abweichung (+18 Min) separat angezeigt. Die „+18 Min“ im alten Abschnitt 18 waren nur die Ende-Abweichung.
2. **„Frei“ wird nicht gespeichert.** Ein Tag ohne Dienst ist frei. Nur wenn CareOS explizite Frei-Einträge braucht, gibt es einen Diensttyp `FREI` mit 0 Minuten.
3. **Urlaub, Krankheit, Fortbildung** sind Diensttypen mit eigener Kategorie (siehe 5.3), keine separaten Systeme. `TimeOffRequest` ist ausschließlich für **Wunschfrei**. Existiert in CareOS bereits ein Abwesenheitsmodell, wird dieses verwendet und angebunden.
4. **Entwurf/Veröffentlichung** braucht eine Plan-Entität (`SchedulePeriod`). Es gibt keine doppelten Dienst-Datensätze für Entwurf und veröffentlichte Version; der Periodenstatus steuert die Sichtbarkeit.
5. **Die KI plant nicht allein.** Jede KI-Zuweisung läuft durch dieselbe deterministische Regel-Engine wie manuelle Änderungen (Abschnitt 7 und 9).
6. **Eine Regel-Engine für alles:** manuelles Bearbeiten, Drag & Drop, Tauschpartner-Suche, Tausch-Ausführung, KI-Validierung, Veröffentlichungsprüfung und KI-Optimierung nutzen dieselben Funktionen.

---

## 3. Zeit- und Datumssemantik

Das ist die häufigste Fehlerquelle in Dienstplänen. Verbindlich:

- Jede Einrichtung/Wohngruppe hat eine **Zeitzone** (Default `Europe/Zurich`, konfigurierbar). Alle Berechnungen in dieser Zeitzone.
- `Shift.date` (`@db.Date`) = **lokaler Kalendertag, an dem der Dienst beginnt.** Ein Nachtdienst 21:45–07:00 gehört zum Starttag.
- `Shift.plannedStart` / `plannedEnd` = absolute Zeitpunkte, `DateTime @db.Timestamptz(3)`, in UTC gespeichert.
- `ShiftType.startTime` / `endTime` = lokale Uhrzeit als `"HH:mm"`. Ist `endTime <= startTime`, endet der Dienst am Folgetag.
- **Dauer wird immer aus den absoluten Zeitpunkten berechnet**, nie aus Uhrzeit-Strings. Dadurch sind Zeitumstellungen korrekt:
  - Nacht 28.→29.03.2026, 21:45–07:00: 495 Min brutto (nicht 555).
  - Nacht 24.→25.10.2026, 21:45–07:00: 615 Min brutto.
- Nachtstunden, Wochenend- und Feiertagsstunden werden minutengenau über die lokalen Zeitfenster berechnet (Dienste über Mitternacht werden aufgeteilt).
- Periodengrenzen: Regeln wie Ruhezeit und Folgetage müssen die **letzten Tage des Vormonats und ersten Tage des Folgemonats** mitladen.
- Datums-/Zeitlogik zentral in `lib/.../time.ts` (reine Funktionen), keine verstreuten `new Date()`-Berechnungen in Komponenten.

---

## 4. Regelwerk (RuleSet) – konfigurierbar, nicht hartkodiert

Arbeitsrechtliche Werte hängen von Land (z. B. CH ArG, DE ArbZG), Gesamtarbeitsvertrag/Tarif und Betrieb ab. **Keine Werte im Code verstecken.** Alle Grenzwerte liegen in einem `RuleSet` (pro Organisation/Einrichtung, optional pro Wohngruppe überschreibbar).

| Feld                          | Bedeutung                                             | Seed-Default (Platzhalter, vom Betreiber zu bestätigen) |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| `timezone`                    | Zeitzone                                              | `Europe/Zurich`                                         |
| `weeklyNormMinutes`           | Wochenarbeitszeit bei 100 %                           | 2520 (42 h)                                             |
| `minRestMinutes`              | Mindest-Ruhezeit zwischen Diensten                    | 660 (11 h)                                              |
| `maxDailyWorkMinutes`         | max. Netto-Arbeitszeit pro Dienst                     | 600                                                     |
| `maxWeeklyWorkMinutes`        | max. Netto-Arbeitszeit pro Kalenderwoche              | 3000                                                    |
| `maxConsecutiveWorkDays`      | max. Arbeitstage am Stück                             | 6                                                       |
| `breakRules` (Json)           | Pausenstaffel `[{ minWorkMinutes, minBreakMinutes }]` | `[{330,15},{420,30},{540,60}]`                          |
| `nightWindow`                 | Nachtfenster lokal                                    | `23:00–06:00`                                           |
| `deviationThresholdMinutes`   | Schwelle für Abweichungswarnung                       | 30                                                      |
| `missingClockOutAfterMinutes` | Warnung bei fehlendem Clock-out nach Dienstende       | 120                                                     |
| `clockInEarliestMinutes`      | frühestes Einstempeln vor Dienstbeginn                | 60                                                      |
| `autoSwapApproval`            | automatische Tausch-Genehmigung                       | `true`                                                  |
| `allowShiftTakeover`          | Dienstübernahme ohne Gegendienst                      | `false`                                                 |

Die Seed-Werte werden in UI und Seed als **„Beispielwerte – rechtlich prüfen“** gekennzeichnet. Die Leitung (bzw. eine Admin-Rolle, siehe 6) kann das RuleSet unter Dienstplan → Einstellungen bearbeiten; jede Änderung wird auditiert.

---

## 5. Datenmodell

### 5.1 Vorgehen

1. Bestehendes Schema analysieren (Phase 0). User, Rollen, Org-Einheiten, Notifications wiederverwenden.
2. Mapping-Tabelle „Spec-Entität → bestehendes Modell / neu“ in ANALYSE.md.
3. Migrationen **additiv**: neue Pflichtfelder auf bestehenden Tabellen nur mit Default oder zweistufig (nullable → Backfill → NOT NULL).
4. Constraints, die Prisma nicht abbilden kann, per `prisma migrate dev --create-only` und handgeschriebenem SQL in der Migration.

### 5.2 Entitäten (an bestehendes Schema anpassen)

**EmployeeProfile** (Erweiterung des bestehenden Users, 1:1)
`userId`, `primaryUnitId`, `pensumPercent` (Beschäftigungsgrad), `weeklyTargetMinutesOverride?`, `employmentStart`, `employmentEnd?`, `active`, `excludedShiftCategories[]` (z. B. keine Nachtdienste – **ohne** Angabe eines Grundes speichern).
Zusätzliche Wohngruppen-Zugehörigkeiten (Springer) über eine Membership-Tabelle, falls CareOS keine hat.

**Qualification**, **EmployeeQualification** (`validFrom`, `validUntil?`).

**ShiftType**
`organizationId`, `unitId?` (null = organisationsweit), `name`, `code` (unique pro Organisation), `category` (`WORK | STANDBY | ON_CALL | ABSENCE`), `absenceKind?` (`VACATION | SICK | TRAINING | OTHER`), `startTime`, `endTime`, `breakMinutes`, `color`, `workTimeFactor` (Anrechnung, z. B. Rufbereitschaft), `creditsTarget` (Abwesenheit wird auf Soll angerechnet), `requiredQualificationIds`, `active`, `sortOrder`.
Diensttypen mit vorhandenen Diensten werden deaktiviert, nicht gelöscht (FK `Restrict`).

**StaffingRequirement** (Mindestbesetzung)
`unitId`, `shiftTypeId`, `weekday?` oder `date?` (Datum überschreibt Wochentag), `minCount`, `maxCount?`, `minQualified?` + `qualificationId?` (z. B. „mind. 1 Fachperson im Nachtdienst“).

**SchedulePeriod**
`unitId`, `year`, `month`, `status` (`DRAFT | PUBLISHED`), `publishedAt?`, `publishedById?`, `lockedAt?` (Monatsabschluss Zeiterfassung), `version`. Unique `(unitId, year, month)`.

**Shift**
`periodId`, `unitId`, `employeeId`, `shiftTypeId`, `category` (denormalisiert, für DB-Constraint), `date`, `plannedStart`, `plannedEnd`, `breakMinutes`, `source` (`MANUAL | DRAG_DROP | AI | SWAP | SEED`), `notes?`, `lastSwapId?`, `version` (Optimistic Locking), `createdAt`, `updatedAt`, `createdById`, `updatedById`.
Löschen: Hard Delete mit vollständigem Vorher-Snapshot im Audit-Log. Dienste mit Zeiteinträgen dürfen nicht gelöscht werden (FK `Restrict` + fachliche Meldung).

**TimeOffRequest** (nur Wunschfrei)
`employeeId`, `unitId`, `startDate`, `endDate`, `priority` (`LOW | MEDIUM | HIGH`), `reason?`, `comment?`, `status` (`OPEN | APPROVED | REJECTED | WITHDRAWN`), `decidedById?`, `decidedAt?`, `decisionComment?`.

**ShiftPreference**
`employeeId`, `kind` (`PREFER_SHIFT_TYPE | AVOID_SHIFT_TYPE | PREFER_WEEKDAY | AVOID_WEEKDAY | AVOID_CATEGORY`), `shiftTypeId?`, `weekday?`, `category?`, `date?`, `validFrom?`, `validUntil?`, `comment?`, `active`.

**ShiftSwap**
`requesterId`, `targetEmployeeId`, `sourceShiftId`, `targetShiftId?` (null = Übernahme, nur wenn `allowShiftTakeover`), `sourceShiftVersion`, `targetShiftVersion?`, `status` (siehe 8.8), `message?`, `requestedAt`, `respondedAt?`, `approvedAt?`, `approvedById?`, `executedAt?`, `failureCode?`, `failureMessage?`.

**TimeEntry**
`employeeId`, `unitId`, `shiftId?` (null = ungeplanter Einsatz), `date`, `clockIn`, `clockOut?`, `breakMinutes`, `source` (`CLOCK | MANUAL | CORRECTION`), `status` (`OPEN | COMPLETE | INCOMPLETE | APPROVED`), `actualMinutes?` (serverseitig berechnet, nie vom Client), `version`.

**TimeCorrectionRequest**
`timeEntryId`, `requestedById`, `requestedClockIn?`, `requestedClockOut?`, `requestedBreakMinutes?`, `reason`, `status` (`OPEN | APPROVED | REJECTED`), `decidedById?`, `decidedAt?`. Originalwerte bleiben über Audit-Log nachvollziehbar.

**PublicHoliday**
`organizationId` bzw. Region, `date`, `name`.

**RuleSet** – siehe Abschnitt 4.

**Notification** – bestehendes System erweitern: `type` (Enum), `title`, `message`, `entityType`, `entityId`, `href`, `readAt?`, `createdAt`.

**AuditLog**
`actorId?` (null = System), `actorLabel` (Name zum Zeitpunkt, Snapshot), `action`, `entityType`, `entityId`, `unitId?`, `before` (Json), `after` (Json), `reason?`, `source` (`UI | SWAP | AI | SYSTEM | SEED`), `correlationId`, `createdAt`.

**AiPlanningRun**
`unitId`, `periodId`, `kind` (`GENERATE | OPTIMIZE`), `status` (`PENDING | RUNNING | SUCCEEDED | FAILED`), `model`, `inputHash`, `requestedById`, `result` (Json), `violations` (Json), `error?`, `appliedAt?`, `appliedById?`, `createdAt`.

Indizes mindestens auf: `Shift(unitId, date)`, `Shift(employeeId, date)`, `TimeEntry(employeeId, date)`, `Notification(userId, readAt)`, `AuditLog(entityType, entityId)`, `AuditLog(unitId, createdAt)`, `ShiftSwap(targetEmployeeId, status)`.

### 5.3 Pflicht-Constraints auf DB-Ebene (Raw SQL in Migration)

Spaltennamen an das tatsächliche Prisma-Mapping anpassen. Wenn eine Extension auf Railway nicht verfügbar ist: melden, nicht stillschweigend weglassen.

```sql
-- Keine überlappenden Arbeitsdienste pro Person (Abwesenheiten ausgenommen).
-- DEFERRABLE, damit ein Tausch innerhalb einer Transaktion kurzzeitig überlappen darf.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Shift"
  ADD CONSTRAINT shift_no_overlap
  EXCLUDE USING gist (
    "employeeId" WITH =,
    tstzrange("plannedStart", "plannedEnd", '[)') WITH &&
  )
  WHERE ("category" <> 'ABSENCE')
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "Shift"
  ADD CONSTRAINT shift_time_order CHECK ("plannedEnd" > "plannedStart");

-- Höchstens ein offener Zeiteintrag pro Person.
CREATE UNIQUE INDEX time_entry_one_open_per_employee
  ON "TimeEntry" ("employeeId") WHERE "clockOut" IS NULL;

-- Höchstens ein aktiver Tausch pro Quelldienst.
CREATE UNIQUE INDEX shift_swap_one_active_per_source
  ON "ShiftSwap" ("sourceShiftId")
  WHERE "status" IN ('PENDING_TARGET', 'PENDING_APPROVAL');

-- Audit-Log ist append-only.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog ist unveränderlich (append-only)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
```

Achtung: Keine Foreign Keys von `AuditLog` mit `onDelete: Cascade` oder `SetNull` – das würde ein UPDATE/DELETE auslösen und am Trigger scheitern. Deshalb `actorLabel` als Snapshot; `actorId` ohne kaskadierende FK. Prüfe, ob CareOS User löscht oder nur deaktiviert.

Die DB-Constraints sind die letzte Verteidigungslinie. Die Regel-Engine muss dieselben Fälle vorher mit verständlicher Meldung abfangen; ein DB-Constraint-Fehler wird trotzdem in eine verständliche Meldung übersetzt, nie roh an den Client gereicht.

---

## 6. Berechtigungen und Datenzugriff

### 6.1 Modell

Rollenbasierte Permissions **plus Scope** (welche Wohngruppen). Bestehendes CareOS-Rollensystem verwenden; falls keins existiert: typisierte Konstante `ROLE_PERMISSIONS` im Code (testbar), keine DB-Tabellen ohne Bedarf.

Permissions:
`dienstplan:read`, `dienstplan:read_own`, `dienstplan:create`, `dienstplan:update`, `dienstplan:delete`, `dienstplan:publish`, `diensttypen:manage`, `regelwerk:manage`, `diensttausch:create`, `diensttausch:approve`, `wunschfrei:create`, `wunschfrei:decide`, `dienstwunsch:create`, `zeiterfassung:read`, `zeiterfassung:read_own`, `zeiterfassung:write_own`, `zeiterfassung:update`, `zeiterfassung:lock`, `ki:use`, `audit:read`.

| Aktion                                        | Mitarbeitende      | Leitung (eigene Wohngruppen) |
| --------------------------------------------- | ------------------ | ---------------------------- |
| Eigene veröffentlichte Dienste sehen          | ✓                  | ✓                            |
| Entwürfe sehen                                | –                  | ✓                            |
| Dienste anlegen/ändern/löschen/verschieben    | –                  | ✓                            |
| Veröffentlichen                               | –                  | ✓                            |
| Wunschfrei / Dienstwunsch einreichen          | ✓ (für sich)       | ✓ (für sich)                 |
| Wunschfrei entscheiden                        | –                  | ✓                            |
| Tausch anfragen / annehmen                    | ✓ (eigene Dienste) | ✓ (eigene Dienste)           |
| Tausch genehmigen                             | –                  | ✓                            |
| Eigene Zeit stempeln, Korrektur beantragen    | ✓                  | ✓                            |
| Zeiten anderer korrigieren, Monat abschließen | –                  | ✓                            |
| KI nutzen                                     | –                  | ✓                            |
| Audit-Log einsehen                            | –                  | ✓                            |

### 6.2 Serverseitige Durchsetzung

- **Jede** Server Action und jeder Route Handler authentifiziert und autorisiert selbst. Server Actions sind öffentliche HTTP-Endpunkte; eine Prüfung nur auf Seitenebene reicht nicht.
- Zentrale Helfer, z. B. `requireSession()`, `requirePermission(ctx, perm)`, `getManagedUnitIds(ctx)`, `assertUnitAccess(ctx, unitId)`.
- **IDs aus dem Client nie vertrauen.** Die Wohngruppe wird aus dem geladenen Datensatz bestimmt (Shift → unitId), nicht aus einem Request-Parameter.
- Datenzugriff über eine Service-/Repository-Schicht, die einen Kontext mit Scope verlangt. Keine ungescopten `prisma.shift.findMany()` in Actions oder Komponenten.
- Fremde Ressourcen liefern `NOT_FOUND` (keine Existenz-Leaks), fehlende Rechte auf eigene Ressourcen `FORBIDDEN`.

### 6.3 Datenschutz

- Kolleg:innen sehen bei Abwesenheiten nur „Abwesend“, nie „Krank“ oder den Grund. Nur Leitung sieht die Kategorie.
- Keine Gesundheitsdaten, Diagnosen oder Gründe für Einschränkungen speichern.
- An die KI gehen nur pseudonymisierte Daten (Abschnitt 9).
- Logs enthalten keine personenbezogenen Freitexte und keine Secrets.

---

## 7. Regel-Engine (Herzstück)

Reine, synchrone TypeScript-Funktionen ohne Prisma-Import, vollständig unit-getestet.

```ts
type Severity = "BLOCK" | "WARN" | "INFO";

type Violation = {
  code: RuleCode;
  severity: Severity;
  message: string; // deutsch, konkret, mit Namen/Zeiten
  employeeId?: string;
  shiftId?: string;
  date?: string; // YYYY-MM-DD lokal
  meta?: Record<string, unknown>;
};

function validateChanges(
  snapshot: ScheduleSnapshot, // Dienste inkl. Randtage, Abwesenheiten, Wunschfrei,
  // Qualifikationen, Besetzung, Profile, RuleSet
  changes: ShiftChange[], // create | update | move | delete | swap
): Violation[];

function analyzeSchedule(snapshot: ScheduleSnapshot): Violation[]; // für Dashboard, Publish, KI-Optimierung
```

Der Server lädt den Snapshot in der Transaktion, ruft die Engine auf und schreibt nur, wenn keine `BLOCK`-Verstöße vorliegen und alle `WARN`-Verstöße vom Benutzer bestätigt wurden.

### 7.1 Regeln

| Code                    | Severity                                 | Beispielmeldung                                                                                 |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `OUT_OF_SCOPE`          | BLOCK                                    | Diese Person gehört nicht zu Ihrer Wohngruppe.                                                  |
| `EMPLOYEE_INACTIVE`     | BLOCK                                    | Lea Beispiel ist ab 01.10.2026 nicht mehr angestellt.                                           |
| `OVERLAP`               | BLOCK                                    | Anna Müller ist am 12.10. bereits von 14:00–22:00 eingeteilt.                                   |
| `ABSENCE_CONFLICT`      | BLOCK                                    | Anna Müller ist vom 10.–14.10. abwesend.                                                        |
| `APPROVED_TIME_OFF`     | BLOCK                                    | Für Anna Müller ist am 12.10. Wunschfrei genehmigt.                                             |
| `REST_TIME`             | BLOCK                                    | Zwischen Spätdienst (Ende 22:00) und Frühdienst (Beginn 06:30) liegen nur 8:30 h statt 11:00 h. |
| `QUALIFICATION_MISSING` | BLOCK                                    | Nachtdienst erfordert „Fachperson Gesundheit“ – fehlt bei Max Meier.                            |
| `EXCLUDED_CATEGORY`     | BLOCK                                    | Max Meier ist nicht für Nachtdienste einplanbar.                                                |
| `MAX_DAILY_WORK`        | BLOCK                                    | Dienst überschreitet die maximale Tagesarbeitszeit (10:30 h > 10:00 h).                         |
| `PERIOD_LOCKED`         | BLOCK                                    | Der Monat September 2026 ist abgeschlossen.                                                     |
| `SHIFT_HAS_TIME_ENTRY`  | BLOCK                                    | Für diesen Dienst wurde bereits Arbeitszeit erfasst.                                            |
| `STALE_VERSION`         | BLOCK                                    | Dieser Dienst wurde inzwischen geändert. Bitte neu laden.                                       |
| `MAX_WEEKLY_WORK`       | WARN                                     | KW 42: 51:00 h geplant, Maximum 50:00 h.                                                        |
| `MAX_CONSECUTIVE_DAYS`  | WARN                                     | Anna Müller hätte 7 Arbeitstage am Stück (max. 6).                                              |
| `MIN_STAFFING`          | WARN (Entwurf) / Bestätigung bei Publish | Mittwoch, Spätdienst: 2 von mindestens 3 Personen.                                              |
| `MIN_QUALIFIED`         | WARN                                     | Nachtdienst 14.10.: keine Fachperson eingeteilt.                                                |
| `MAX_STAFFING`          | INFO                                     | Montag Frühdienst: 5 Personen, vorgesehen max. 4.                                               |
| `OPEN_TIME_OFF_IGNORED` | INFO                                     | Offener Wunschfrei-Antrag von Anna Müller am 12.10.                                             |
| `PREFERENCE_IGNORED`    | INFO                                     | Dienstwunsch „keine Spätdienste am Freitag“ nicht berücksichtigt.                               |
| `TARGET_DEVIATION`      | INFO                                     | Geplant 172 h, Soll 168 h (+4 h).                                                               |

Mindestbesetzung ist im Entwurf bewusst nur eine Warnung, sonst ließe sich ein Plan nicht schrittweise aufbauen. Beim Veröffentlichen müssen offene `MIN_STAFFING`/`MIN_QUALIFIED`-Warnungen ausdrücklich bestätigt werden (mit Begründung, auditiert).

`WARN` darf die Leitung mit Begründung übersteuern: Die Action wird erneut mit `acknowledgedWarnings: RuleCode[]` und `overrideReason` aufgerufen; beides landet im Audit-Log. `BLOCK` ist nie übersteuerbar.

---

## 8. Funktionen

### 8.1 Dienstplan für die Leitung (`/dienstplan`)

Sidebar: Unter „Leitung“ Menüpunkt **Dienstplan** (Lucide `CalendarDays`), sichtbar nur mit `dienstplan:read`. Für alle mit `dienstplan:read_own` zusätzlich **Mein Dienstplan**. Die Sidebar-Sichtbarkeit ist Komfort, keine Sicherheit.

Kopfbereich: Monat mit ‹ / Heute / ›, Monatsauswahl, Monats-/Wochenansicht, Wohngruppen-Auswahl (falls mehrere), Suche, Filter (Diensttyp, Qualifikation, nur Konflikte), Status-Badge Entwurf/Veröffentlicht, Buttons „Dienst hinzufügen“, „✨ Mit KI planen“, „Analysieren“, „Veröffentlichen“. Monat und Ansicht stehen in der URL (`?monat=2026-10&ansicht=monat`), damit Links und Zurück-Button funktionieren.

Raster: Zeilen = Mitarbeitende (Name, Pensum, Soll/geplant im Monat), Spalten = Tage (Wochenende und Feiertage markiert, heute hervorgehoben), sticky Kopfzeile und Namensspalte. Fußzeile pro Tag und Diensttyp: Ist-Besetzung / Mindestbesetzung mit Farbindikator.

Dienstkarte (kompakt): Kürzel + Farbe, Zeiten. Tooltip/Popover mit: Diensttyp, Beginn–Ende, Dauer netto, Pause, Ist-Zeit und Differenz (falls erfasst), Badges „↔ Getauscht“, „KI“, Warnungen, Überstunden.

Dashboard-Kacheln (alle aus echten Daten): Mitarbeitende in der Wohngruppe, Dienste heute, offene Wunschfrei-Anträge, offene Tausch-Anfragen/Genehmigungen, Arbeitszeitabweichungen, Tage mit Unterbesetzung, Mitarbeitende mit Soll-Abweichung. Jede Kachel ist klickbar und filtert das Raster bzw. öffnet die Liste.

### 8.2 Diensttypen, Mindestbesetzung, Regelwerk

Unterseite „Einstellungen“ mit Tabs: Diensttypen (CRUD, aktiv/inaktiv, Farbauswahl mit ausreichendem Kontrast in Light/Dark), Mindestbesetzung (Matrix Wochentag × Diensttyp, Datumsausnahmen), Regelwerk (Abschnitt 4), Feiertage. Alle Änderungen auditiert.

### 8.3 Drag & Drop

- Library: vorhandene verwenden, sonst `@dnd-kit/core` (Pointer-, Touch- und Keyboard-Sensor; Touch mit Aktivierungsverzögerung, damit horizontales Scrollen funktioniert).
- Ablegen auf leere Zelle = verschieben (anderer Tag und/oder andere Person).
- Ablegen auf belegte Zelle = Dialog „Dienste tauschen“ oder „Abbrechen“. Nie stilles Überschreiben.
- Optional: Modifier-Taste = kopieren.
- Barrierefreie Alternative ohne Drag: Kontextmenü „Verschieben nach…“.
- Ablauf: optimistische Anzeige → Server Action `moveShift` mit `expectedVersion` → Engine → bei `BLOCK` Rollback + Toast mit konkreter Meldung; bei `WARN` Bestätigungsdialog mit Begründungsfeld → erneuter Aufruf.
- Nach Erfolg in einer Transaktion: Dienst aktualisieren, Audit-Eintrag, Benachrichtigung an betroffene Person(en) – bei Entwürfen keine Benachrichtigung an Mitarbeitende (sie sehen Entwürfe nicht).

### 8.4 Entwurf und Veröffentlichung

- Neue Periode startet als `DRAFT`. Mitarbeitende sehen Entwürfe nicht.
- „Veröffentlichen“: `analyzeSchedule` ausführen, Zusammenfassung zeigen (Blocker verhindern Veröffentlichung, Warnungen müssen bestätigt werden), dann Status `PUBLISHED`, Audit, Benachrichtigung an alle Mitarbeitenden mit Diensten im Monat.
- Änderungen an veröffentlichten Plänen sind erlaubt, wirken sofort und benachrichtigen die betroffenen Personen („Dein Dienst am 12.10. wurde geändert: Spät → Früh“).
- Zurücksetzen auf Entwurf nur, solange keine Zeiteinträge existieren; auditiert.

### 8.5 Mein Dienstplan (`/mein-dienstplan`)

Nur eigene Dienste aus veröffentlichten Perioden. Monats-/Wochenansicht, Heute, Detail-Sheet pro Dienst (Zeiten, Ist-Zeit, Differenz, Tausch-Status). Monatssummen: Soll, geplant, Ist, Saldo. Aktionen: Einstempeln/Ausstempeln, Wunschfrei beantragen, Dienstwunsch erfassen, Dienst tauschen, Korrektur beantragen. Liste „Meine Anträge“ mit Status.

### 8.6 Wunschfrei

Formular: Datum oder Zeitraum, Priorität, Grund (optional), Kommentar. Status `OPEN → APPROVED | REJECTED`, jederzeit `WITHDRAWN` durch Antragsteller:in solange offen.

- Neuer Antrag → Benachrichtigung an Leitung.
- Entscheidung → Benachrichtigung an Antragsteller:in.
- Genehmigen ist nur möglich, wenn am Tag kein Dienst existiert; sonst zeigt der Dialog den Konflikt und bietet „Dienst entfernen und genehmigen“ an (eine Transaktion, auditiert, betroffene Person informiert).
- Genehmigt = harte Regel (`APPROVED_TIME_OFF`); offen = Hinweis im Raster.

### 8.7 Dienstwünsche

Erfassen und verwalten gemäß `ShiftPreference`. Leitung sieht Wünsche als Icon in der Zeile und im Planungs-Sheet. Wünsche sind Planungshinweise (`INFO`), nie garantiert. Die KI berücksichtigt sie als weiche Ziele.

### 8.8 Diensttausch

**Zustandsautomat**

```
PENDING_TARGET ──(Ziel lehnt ab)──────────────► DECLINED
      │        ──(Antragsteller zieht zurück)─► WITHDRAWN
      │        ──(Dienst geändert/Datum vorbei)► EXPIRED
      │
  (Ziel akzeptiert, Revalidierung ok)
      │
      ├── autoSwapApproval = true  ──────────► EXECUTED
      └── autoSwapApproval = false ──► PENDING_APPROVAL
                                          ├─(Leitung genehmigt, Revalidierung ok)► EXECUTED
                                          ├─(Leitung lehnt ab)─────────────────► REJECTED
                                          └─(Dienst geändert)──────────────────► EXPIRED
Revalidierung schlägt fehl ───────────────────► FAILED (mit Grund)
```

**Tauschpartner-Suche** (`getSwapCandidates(shiftId)`): Für jede aktive Person derselben Wohngruppe den Tausch simulieren (beide Dienstpläne nach dem Tausch, inkl. Randtage) und `validateChanges` für **beide** Personen ausführen. Nur Kandidaten ohne `BLOCK` werden angezeigt, sortiert nach Anzahl Warnungen. Angezeigt werden nur Name und der jeweilige Gegendienst – keine weiteren Plandaten. Übernahme ohne Gegendienst nur bei `allowShiftTakeover`.

**Nicht tauschbar:** Dienste in der Vergangenheit oder bereits begonnen, Dienste mit Zeiteintrag, Dienste in Entwürfen, Abwesenheiten, Dienste mit aktivem Tausch, abgeschlossene Perioden.

**Ausführung** (`executeSwap`, interaktive Prisma-Transaktion):

1. Beide Dienstzeilen in fester Reihenfolge (nach ID) mit `SELECT … FOR UPDATE` sperren (Deadlock-Vermeidung).
2. `version` gegen `sourceShiftVersion`/`targetShiftVersion` prüfen → bei Abweichung `EXPIRED`.
3. Snapshot laden, Engine erneut ausführen → bei `BLOCK` `FAILED` mit Grund.
4. `employeeId` der beiden Dienste tauschen, `version + 1`, `source = SWAP`, `lastSwapId` setzen.
5. Swap auf `EXECUTED`, Audit-Einträge mit Vorher/Nachher beider Dienste, Benachrichtigungen an beide Personen und die Leitung.
6. Alles oder nichts. Der deferrable Overlap-Constraint verhindert Zwischenzustands-Fehler.

Im Raster: Badge „↔ Getauscht“ mit Tooltip (mit wem, wann). Leitung sieht alle Tausche in einer Liste, auch automatisch ausgeführte.

### 8.9 Zeiterfassung

- Einstempeln ab `clockInEarliestMinutes` vor Dienstbeginn; der Eintrag wird dem passenden Dienst zugeordnet. Ohne passenden Dienst: ungeplanter Einsatz (`shiftId = null`), Hinweis an Leitung.
- Zeitstempel setzt **der Server**, nicht der Client.
- Pause: Standard = geplante Pause des Dienstes; optional Pause starten/beenden. Liegt die erfasste Pause unter der gesetzlichen Staffel (`breakRules`), wird das markiert, nicht still korrigiert.
- `actualMinutes = (clockOut − clockIn) − breakMinutes`, serverseitig berechnet.
- Fehlender Clock-out nach `missingClockOutAfterMinutes`: Status `INCOMPLETE`, Benachrichtigung an Person und Leitung. Es wird keine Zeit geraten.
- Abweichung `|Ist − Soll| ≥ deviationThresholdMinutes` → Benachrichtigung an Leitung („⚠️ Anna Müller: +3:00 h gegenüber Dienstplan“).
- Korrekturen: Mitarbeitende beantragen (`TimeCorrectionRequest`), Leitung entscheidet; direkte Korrektur durch Leitung nur mit Begründung. Alles auditiert.
- Monatsabschluss (`lockedAt`): danach keine Änderungen mehr, außer mit `zeiterfassung:lock` durch Wiedereröffnen (auditiert).
- Wie das Überschreiten von Mitternacht bei Nachtdiensten und Zeitumstellungen behandelt wird: siehe Abschnitt 3.

Im Raster (Leitung) je Dienst: Geplant, Ist, Differenz, Beginn-/Ende-Abweichung.

### 8.10 Arbeitszeitübersicht

Tabelle pro Person und Monat mit Filtern (Person, Wohngruppe, Monat, Diensttyp):
Soll, geplant, Ist, Saldo (Über-/Minusstunden), Nachtstunden, Wochenendstunden, Feiertagsstunden, Abwesenheitstage nach Kategorie.

**Sollberechnung** (in DECISIONS.md bestätigen lassen):
`Tagessoll = weeklyNormMinutes × pensumPercent / 100 / 5`
`Monatssoll = Tagessoll × Anzahl Werktage (Mo–Fr) ohne Feiertage`
Abwesenheiten mit `creditsTarget` werden mit Tagessoll angerechnet. Rufbereitschaft mit `workTimeFactor`.
Ist-Stunden kommen aus Zeiteinträgen; ohne Zeiteintrag zählt ein vergangener Dienst als „nicht erfasst“, nicht als geleistet.

### 8.11 Benachrichtigungen

Bestehendes System erweitern. Benachrichtigungen werden **in derselben Transaktion** wie die fachliche Änderung erzeugt. Typen:
`TIME_OFF_REQUESTED`, `TIME_OFF_DECIDED`, `PREFERENCE_SUBMITTED`, `SWAP_REQUESTED`, `SWAP_ACCEPTED`, `SWAP_DECLINED`, `SWAP_APPROVAL_NEEDED`, `SWAP_EXECUTED`, `SWAP_REJECTED`, `SWAP_FAILED`, `SHIFT_CHANGED`, `SHIFT_DELETED`, `SCHEDULE_PUBLISHED`, `TIME_DEVIATION`, `CLOCK_OUT_MISSING`, `TIME_CORRECTION_REQUESTED`, `TIME_CORRECTION_DECIDED`, `STAFFING_PROBLEM`.
Empfängerermittlung zentral (`resolveRecipients`). Jede Benachrichtigung hat einen Link auf die betroffene Stelle. Glocke in der Sidebar mit Zähler ungelesener Einträge, Notification Center mit „alle als gelesen markieren“.

### 8.12 Audit-Log

Jede schreibende Operation schreibt einen Eintrag mit Vorher/Nachher-Snapshot, Akteur, Quelle, Begründung und `correlationId` (verbindet z. B. beide Dienste eines Tauschs). Append-only per Trigger (5.3). Ansicht für die Leitung: filterbar nach Person, Zeitraum, Aktion; pro Dienst ein Verlauf im Detail-Sheet.

### 8.13 Aktualisierung ohne Neuladen

Erst prüfen, ob CareOS Realtime nutzt – dann anbinden. Sonst:

- Basis: Polling alle 20–30 s auf eine leichte Route (`/api/dienstplan/changes?since=…` liefert nur geänderte IDs/Version der Periode), danach gezielt neu laden; Pausieren bei inaktivem Tab.
- Optional später: SSE mit Postgres `LISTEN/NOTIFY`.
  Keine schwere Realtime-Infrastruktur ohne Freigabe.

---

## 9. KI-Planung mit Mistral

### 9.1 Grundprinzip

LLMs lösen harte Constraint-Probleme nicht zuverlässig. Deshalb:

- **Fakten berechnet der Code**, die KI schlägt vor und erklärt.
- **Jede KI-Zuweisung wird von der Regel-Engine geprüft.** Ungültige Zuweisungen werden verworfen und mit Grund angezeigt, nie still übernommen.
- Die KI veröffentlicht nie. „Übernehmen“ schreibt Entwurfsdienste (`source = AI`); die Periode bleibt `DRAFT`.

### 9.2 Plan erstellen

1. Leitung wählt Zeitraum (Woche/Monat) und Optionen (bestehende Dienste behalten ja/nein).
2. Server baut Input: pseudonymisierte Personen (`E1`, `E2`, …) mit Pensum, Sollminuten, Qualifikations-Codes, ausgeschlossenen Kategorien, Nichtverfügbarkeit (nur „nicht verfügbar“, ohne Grund), genehmigtes Wunschfrei (hart), offenes Wunschfrei und Dienstwünsche (weich), bestehende Dienste, Diensttypen, Mindestbesetzung, RuleSet-Grenzwerte. **Keine Namen, keine Gesundheitsdaten, keine Freitexte.**
3. Aufruf serverseitig über das offizielle Mistral-SDK, Modell per `MISTRAL_MODEL` (z. B. `mistral-large-latest`), strukturierte JSON-Ausgabe gemäß aktueller Mistral-Doku. Planung wochenweise, damit Ausgaben klein und prüfbar bleiben.
4. Ausgabe mit Zod parsen. Schema:
   ```ts
   { assignments: { employeeRef: string; date: string; shiftTypeCode: string }[];
     notes: { date?: string; text: string }[] }
   ```
5. Unbekannte Referenzen, ungültige Daten, ungültige Codes → verworfen mit Grund.
6. Engine prüft alle Zuweisungen gemeinsam. Bei `BLOCK`: einmalige Korrekturrunde mit den Verstößen als Feedback (max. 2 Runden, Timeout). Danach verbleibende ungültige Zuweisungen verwerfen.
7. Ergebnis als `AiPlanningRun` speichern (inkl. Modell, Input-Hash, Verstöße). Lange Läufe asynchron: Run anlegen, Client pollt den Status.

**Vorschau:** Diff-Ansicht im Raster (neu/unverändert/verworfen), Zusammenfassung (Besetzung erfüllt ja/nein pro Tag, Soll-Abweichung pro Person, berücksichtigte/nicht berücksichtigte Wünsche). Buttons: **Übernehmen** (alle gültigen oder ausgewählte, eine Transaktion, erneute Validierung, Audit mit `source = AI`), **Ändern** (übernehmen und im Raster weiterbearbeiten), **Verwerfen**.

### 9.3 Plan analysieren/optimieren

1. `analyzeSchedule` berechnet deterministisch alle Probleme (Unterbesetzung, Überbesetzung, Folgetage, ungünstige Folgen wie Nacht→Früh, Soll-Abweichungen, ignorierte Wünsche, ungleiche Verteilung von Nacht-/Wochenenddiensten).
2. Mistral bekommt diese Befunde (pseudonymisiert) und formuliert priorisierte Vorschläge mit Begründung, optional konkrete Aktionen (`move`, `swap`, `assign`).
3. Jede vorgeschlagene Aktion wird von der Engine geprüft; nur gültige erhalten einen „Anwenden“-Button. Die KI darf keine Befunde erfinden: Aussagen wie „Mittwoch Spätdienst unterbesetzt“ müssen auf einem berechneten Befund beruhen.
4. Namen werden erst serverseitig nach der Antwort wieder eingesetzt.

### 9.4 Sicherheit

- `MISTRAL_API_KEY` nur serverseitig (`server-only`-Import in `lib/ai`), in `.env.example` ohne Wert dokumentiert, nie im Client-Bundle, nie in Logs.
- Prompt-Inhalte nicht vollständig loggen.
- Rate-Limit pro Leitung (z. B. 10 Läufe/Stunde, konfigurierbar).
- Fehlender Key → Feature in der UI deaktiviert mit klarer Meldung, Rest des Moduls funktioniert.

---

## 10. Server Actions / API

Mutationen als Server Actions, Polling und KI-Status als Route Handlers. Einheitliches Ergebnisformat, nie rohe Exceptions an den Client:

```ts
type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string; violations?: Violation[] } };
```

Jede Operation: authentifizieren → autorisieren (Permission + Scope) → Zod-Validierung → Transaktion → Engine → schreiben → Audit → Benachrichtigung → `revalidatePath`/-Tag.

Operationen (Namen an bestehende Konvention anpassen):
`getSchedule`, `getMySchedule`, `createShift`, `updateShift`, `deleteShift`, `moveShift`, `publishSchedule`, `revertScheduleToDraft`, `getSwapCandidates`, `createSwap`, `respondToSwap`, `approveSwap`, `rejectSwap`, `withdrawSwap`, `createTimeOffRequest`, `decideTimeOffRequest`, `withdrawTimeOffRequest`, `upsertShiftPreference`, `clockIn`, `clockOut`, `startBreak`, `endBreak`, `requestTimeCorrection`, `decideTimeCorrection`, `updateTimeEntry`, `lockPeriod`, `getWorkTimeSummary`, `startAiPlanning`, `getAiPlanningRun`, `applyAiPlanningRun`, `startAiAnalysis`, CRUD für Diensttypen, Mindestbesetzung, RuleSet, Feiertage.

Zod-Schemas liegen zentral (z. B. `lib/dienstplan/schemas.ts`) und werden von Formularen und Server gemeinsam genutzt.

---

## 11. UI/UX

- shadcn/ui-Komponenten wiederverwenden: Calendar, Dialog, Sheet, Drawer, DropdownMenu, Select, Tabs, Badge, Tooltip, Alert, Table, Card, Popover, Command, Sonner.
- Ruhige, professionelle Healthcare-Optik, keine dekorativen Gradients, Dark/Light-Mode über bestehende Theme-Tokens.
- Diensttyp-Farben immer zusammen mit Kürzel – Information nie nur über Farbe.
- Loading: Skeletons in Rastergröße. Empty States mit nächster sinnvoller Aktion („Noch keine Dienste für Oktober – Dienst hinzufügen oder mit KI planen“). Error States mit Wiederholen.
- Fehlermeldungen immer konkret (siehe 7.1), nie nur „Fehler“.
- Optimistic UI nur bei Verschieben/Bearbeiten im Raster, mit Rollback.
- **Mobile:** Mitarbeitende untereinander, Tage horizontal scrollbar mit sticky Namensspalte, kompakte Karten, Aktionen im Bottom Sheet (Drawer), Touch-Drag mit Long-Press. „Mein Dienstplan“ auf Mobile als Wochenliste mit großem Stempel-Button.
- Tastaturbedienbarkeit: Raster per Pfeiltasten navigierbar, Aktionen per Kontextmenü.
- UI-Locale laut Abschnitt 15 (de-CH oder de-DE): Datums-/Zahlenformat über `Intl`.

---

## 12. Tests

Test-Setup des Projekts verwenden; falls keines vorhanden: Vitest für Unit/Integration. Integrationstests laufen gegen eine **echte lokale Test-Postgres** (eigene `DATABASE_URL` für Tests), nicht gegen gemockte Prisma-Clients – nur so werden Constraints und Trigger mitgetestet. Mistral wird in Tests durch ein Test-Double ersetzt.

**Zeitberechnung (Unit)**

- 06:30–15:00, 30 Min Pause → 480 Min Soll.
- Ist 06:42–15:18, 30 Min Pause → 486 Min, Differenz +6, Beginn +12, Ende +18.
- Nacht 21:45–07:00 am 28.03.2026 → 495 Min brutto; am 24.10.2026 → 615 Min brutto.
- Nachtstunden-Anteil eines Dienstes über Mitternacht.
- Fehlender Clock-out → kein `actualMinutes`, Status `INCOMPLETE`.
- Negative Differenz, Pause unter Staffel wird markiert.
- Monatssoll mit Pensum 80 %, Feiertag und Urlaubstag.

**Regel-Engine (Unit)**

- Spät (Ende 22:00) → Früh (Beginn 06:30) Folgetag → `REST_TIME` BLOCK.
- Ruhezeit über Monatsgrenze (30.09. Spät → 01.10. Früh).
- Überschneidung, Abwesenheit, genehmigtes Wunschfrei, fehlende Qualifikation, ausgeschlossene Kategorie, inaktive Person.
- Mindestbesetzung unterschritten → WARN, nicht BLOCK.

**Diensttausch (Integration)**

- Gültiger Tausch Früh↔Spät am selben Tag wird atomar ausgeführt (beide Dienste geändert, 2 Audit-Einträge mit gleicher `correlationId`, 3 Benachrichtigungen).
- Tausch, der für eine Person die Ruhezeit verletzt → nicht als Kandidat angeboten und bei Ausführung `FAILED`.
- Fehlende Qualifikation, andere Wohngruppe, bereits getauschter/geänderter Dienst (`EXPIRED`), Dienst in der Vergangenheit.
- Zwei gleichzeitige Annahmen/Tausche auf denselben Dienst → genau einer wird ausgeführt.
- `autoSwapApproval = false` → `PENDING_APPROVAL`, erst Genehmigung führt aus.
- Simulierter Fehler nach dem ersten Update → Rollback, kein Dienst verändert.

**Berechtigungen (Integration)**

- Mitarbeitende:r ändert fremden Dienst per direkter Action mit fremder ID → abgelehnt, DB unverändert.
- Mitarbeitende:r sieht keine Entwürfe und keine Dienste anderer (außer Tauschkandidaten-Sicht).
- Leitung A verschiebt Dienst auf Person aus Wohngruppe B → abgelehnt.
- Leitung verwaltet eigene Mitarbeitende erfolgreich.
- Ohne Session / ohne Permission → kein Zugriff.
- Kolleg:innen sehen „Abwesend“ statt „Krank“.

**Datenbank (Integration)**

- Overlap-Constraint greift auch bei direktem Prisma-Insert.
- UPDATE/DELETE auf AuditLog schlägt fehl.
- Zweiter offener Zeiteintrag pro Person schlägt fehl.

**KI (Unit/Integration mit Test-Double)**

- Ungültiges JSON, falsches Schema, unbekannte `employeeRef`, unbekannter Code → abgefangen, verständliche Meldung.
- Zuweisung mit Ruhezeitverstoß wird verworfen und angezeigt.
- `applyAiPlanningRun` lässt die Periode im Status `DRAFT`.
- Input enthält keine Namen und keine Abwesenheitsgründe.
- Fehlender API-Key → sauberer Fehler, kein Crash.

---

## 13. Seed-Daten

- Deterministisch und idempotent (Upserts, feste IDs oder fester Zufalls-Seed), zweimal ausführbar.
- Relativ zum aktuellen Monat, damit die Demo immer „jetzt“ zeigt (Vormonat abgeschlossen mit Zeiteinträgen, aktueller Monat veröffentlicht, Folgemonat als Entwurf).
- 1 Organisation, 1 Einrichtung, 3 Wohngruppen, je 1 Leitung und 8–12 Mitarbeitende mit unterschiedlichen Pensen und Qualifikationen, 1 Springer in zwei Gruppen.
- Diensttypen (Früh, Spät, Nacht, Zwischendienst, Bereitschaft, Rufbereitschaft, Urlaub, Krank, Fortbildung), Mindestbesetzung, RuleSet mit gekennzeichneten Beispielwerten, Feiertage des laufenden Jahres.
- Wunschfrei (offen/genehmigt/abgelehnt), Dienstwünsche, Tausche in verschiedenen Status, Zeiteinträge inkl. Abweichung und fehlendem Clock-out, Benachrichtigungen, Audit-Einträge.
- Ausschließlich erfundene Namen. Demo-Logins pro Rolle im README dokumentieren (nur Dev).
- Schutz: Seed bricht ab, wenn `NODE_ENV=production`, außer mit explizitem Flag.

---

## 14. Phasenplan mit Definition of Done

Jede Phase endet mit grünen Checks (0.7), Commit und Bericht (0.6).

**Phase 0 – Analyse (read-only, Plan Mode)**
Keine Codeänderungen. Ergebnis `docs/dienstplan/ANALYSE.md`: Stack und Versionen, Auth und Session-Zugriff, Rollen/Permissions, Org-Struktur, Navigation, Notification-System, UI-Komponenten, Test-Setup, DB-/Migrations-Workflow, vorhandene Realtime-/Job-Lösungen, Mapping-Tabelle Spec → bestehend/neu, Risiken, Antworten bzw. offene Punkte zu Abschnitt 15. Danach Stopp.

**Phase 1 – Fundament**
Prisma-Modelle, Migration inkl. Raw-SQL-Constraints, Permission-/Scope-Helfer, Audit-Service, Notification-Erweiterung, Seed.
DoD: Migration auf frischer DB und auf DB mit bestehenden CareOS-Daten erfolgreich; Seed idempotent; DB- und Permission-Tests grün; bestehende Tests weiterhin grün.

**Phase 2 – Regel-Engine und Zeitberechnung**
Reine Funktionen aus Abschnitt 3, 4, 7, 8.10.
DoD: alle Unit-Tests aus Abschnitt 12 zu Zeit und Regeln grün, keine Prisma-Abhängigkeit in der Engine.

**Phase 3 – Dienstplan Leitung**
Seite, Raster, CRUD, Drag & Drop, Konfliktdialoge, Diensttypen/Besetzung/Regelwerk-Einstellungen, Veröffentlichung, Dashboard, Sidebar.
DoD: Monat anlegen, planen, verschieben, veröffentlichen komplett über die UI mit Seed-Daten durchspielbar; Blocker und Warnungen erscheinen mit konkreten Texten; responsive geprüft.

**Phase 4 – Mitarbeitende, Wunschfrei, Dienstwünsche**
`/mein-dienstplan`, Anträge, Entscheidungen durch Leitung, Benachrichtigungen.
DoD: Antrag → Benachrichtigung → Entscheidung → Benachrichtigung funktioniert; Berechtigungstests grün.

**Phase 5 – Diensttausch**
Kandidatensuche, Zustandsautomat, atomare Ausführung, Einstellung Auto-Genehmigung, Anzeige im Raster.
DoD: alle Tausch-Tests aus Abschnitt 12 grün inkl. Nebenläufigkeit.

**Phase 6 – Zeiterfassung und Auswertung**
Stempeln, Pausen, Korrekturen, Abweichungswarnungen, fehlender Clock-out, Monatsabschluss, Soll/Ist im Raster, Arbeitszeitübersicht.
DoD: Zeit-Tests grün, Soll/Ist/Saldo stimmen mit Seed-Daten nachvollziehbar überein.

**Phase 7 – KI**
Planung und Analyse gemäß Abschnitt 9.
DoD: KI-Tests grün; mit echtem Key (lokal) ein Wochenplan erzeugt, validiert, als Entwurf übernommen; ohne Key sauber deaktiviert.

**Phase 8 – Aktualisierung, Feinschliff, Abnahme**
Polling/Realtime, Mobile-Feinschliff, Accessibility, Performance (Raster mit 40 Personen × 31 Tagen flüssig), E2E-Tests der Kernabläufe falls Playwright vorhanden, Abschluss-DoD:
Alle Checks aus 0.7 grün · alle Funktionen aus Abschnitt 8 und 9 über die UI nutzbar · keine Mock-Daten · Berechtigungen serverseitig getestet · bestehende CareOS-Funktionen unverändert funktionsfähig · README-Abschnitt zum Modul (Setup, Env-Variablen, Demo-Logins, bekannte Grenzen).

---

## 15. Offene Fragen (in Phase 0 klären, nicht raten)

Vorgeschlagene Defaults gelten erst nach Bestätigung.

1. **Rechtsraum und Regelwerte:** Schweiz (ArG, ggf. GAV) oder Deutschland (ArbZG, ggf. TVöD/AVR)? Konkrete Werte für Abschnitt 4 und Sollberechnung 8.10?
2. **Sichtbarkeit für Mitarbeitende:** nur eigene Dienste (Default) oder veröffentlichter Teamplan der eigenen Wohngruppe (mit „Abwesend“ statt Grund)?
3. **Dienstübernahme ohne Gegendienst** erlauben? Default: nein.
4. **Genehmigtes Wunschfrei** als harte Regel? Default: ja.
5. **Pausen:** pauschal aus Diensttyp (Default) oder aktiv gestempelt?
6. **Einstempeln:** nur im Browser (Default) oder weitere Wege geplant?
7. **Springer** in mehreren Wohngruppen: gibt es das? Wer plant sie?
8. **Stellvertretende Leitung** mit denselben Rechten?
9. **Wer pflegt Regelwerk und Diensttypen** – Leitung pro Wohngruppe oder eine Admin-Rolle organisationsweit?
10. **UI-Locale:** de-CH (ss, `12.10.2026`) oder de-DE?
11. **Realtime/Jobs:** Gibt es bereits eine Lösung (z. B. Queue, Cron auf Railway) für Clock-out-Erinnerungen und KI-Läufe?

---

## Anhang: Ergänzung für `CLAUDE.md`

```markdown
## Dienstplan-Modul

- Spec: docs/specs/dienstplan.md (fachliche Source of Truth), Fortschritt: docs/dienstplan/PROGRESS.md, Entscheidungen: docs/dienstplan/DECISIONS.md
- Arbeite phasenweise, stoppe nach jeder Phase.
- Alle Validierungen laufen über die Regel-Engine in lib/dienstplan/rules – keine Regel-Logik in Komponenten oder Actions duplizieren.
- Jede Server Action prüft selbst Session, Permission und Scope. Keine ungescopten Prisma-Queries.
- Zeiten: Timestamptz in UTC, Dauer aus absoluten Zeitpunkten, Zeitzone aus RuleSet.
- Nie destruktive Prisma-Befehle gegen nicht-lokale Datenbanken.
```
