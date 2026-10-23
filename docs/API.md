# CareOS API

CareOS ist API-first (PRD §40/§41). Es gibt drei Schnittstellen:

| Schnittstelle | Basis-URL | Zweck |
|---|---|---|
| REST API v1 | `/api/v1` | Lesen und Schreiben ausgewählter Daten (JSON), Patientenadministration (ADT) |
| HL7 FHIR R4 | `/api/fhir` | Gesundheitsdaten im FHIR-Format: lesend; `Observation` (Vitalwerte), `AllergyIntolerance` und `DocumentReference` (externe Berichte) auch schreibend |
| HL7 v2 | `/api/v1/hl7` | Patientenadministration (ADT A01/A02/A03/A21/A22) aus Spital- und Klinikinformationssystemen |
| Webhooks | Ziel-URL des Empfängers | Domain Events in Echtzeit (HTTP POST, signiert) |

**Maschinenlesbar:** `GET /api/v1/openapi.json` (OpenAPI 3.1, ohne Anmeldung, Quelle `src/lib/api-spec.ts`). Ein Test
(`src/lib/api-spec.test.ts`) prüft, dass jede Route unter `src/app/api/v1` und `src/app/api/fhir` mit allen HTTP-Methoden und Scopes beschrieben ist.
**In der App:** Developer-Portal unter **Mehr → Developer-Portal** (`/developer`, Berechtigung `api.personal` oder `admin.integrations`):
Referenz mit Beispielen, Scopes, Signaturprüfung, persönliche Tokens, Testzustellung an Webhooks.

Alle Daten sind auf die Organisation des Tokens beschränkt. Zeiten sind ISO 8601 in UTC (`2026-10-21T08:00:00.000Z`), Datumswerte `YYYY-MM-DD`.

## Authentifizierung

Zwei Arten von API-Tokens:

| Art | Erstellt unter | Berechtigung | Ablauf | Scopes |
|---|---|---|---|---|
| Integrations-Token | Admin → Integrationen und API → API-Tokens | `admin.integrations` | optional (7, 30, 90, 365 Tage oder unbefristet) | frei wählbar |
| Persönliches Token | Developer-Portal → Meine Tokens | `api.personal` | Pflicht, höchstens 365 Tage | nur, wenn die Person die zugehörigen Berechtigungen **organisationsweit** hat (siehe unten); bei jedem Aufruf erneut geprüft |

```
Authorization: Bearer cos_…
```

- Das Token wird **nur einmal** angezeigt. Gespeichert wird ausschliesslich ein SHA-256-Hash; verlorene Tokens können nicht wiederhergestellt, nur widerrufen und neu erstellt werden.
- Ein Token ist an die Person gebunden, die es erstellt hat. Schreibende Aufrufe werden ihr zugeordnet (z. B. `Observation.authorId`) und im Audit-Protokoll mit `context.via = "api"` und der Token-ID vermerkt. Wird die Person deaktiviert, ist das Token ungültig.
- Widerrufene und abgelaufene Tokens werden sofort abgewiesen (`401`).
- Persönliche Tokens erweitern keine Rechte: Die API liefert organisationsweit, deshalb erhält ein persönliches Token einen Scope nur, wenn die Person alle Berechtigungen der Tabelle unten in einer **organisationsweiten** Rolle hat (Bereichsrollen genügen nicht). Wird eine Rolle entzogen oder ein Modul abgeschaltet, antwortet der nächste Aufruf mit `403 insufficient_permission`. Ein laufender Notfallzugriff zählt nie.
- Ist die Organisation gesperrt (Plattform-Betrieb), werden alle Tokens mit `403 org_suspended` abgewiesen.

### Scopes

| Scope | Erlaubt | Persönliches Token: nötige Berechtigungen (organisationsweit) |
|---|---|---|
| `residents:read` | `GET /api/v1/residents`, `GET /api/v1/residents/{id}` | `resident.read` |
| `residents:adt` | `POST /api/v1/residents` (Eintritt), `POST /api/v1/residents/{id}/adt` (Verlegung, Abwesenheit, Rückkehr, Austritt), `POST /api/v1/hl7` (HL7 v2 ADT) | `resident.edit` |
| `tasks:read` | `GET /api/v1/tasks`, `GET /api/v1/tasks/{id}` | `task.read` |
| `tasks:write` | `POST /api/v1/tasks`, `PATCH /api/v1/tasks/{id}` | `task.manage`, `task.complete` |
| `observations:write` | `POST /api/v1/observations`, `POST /api/fhir/Observation`, `POST /api/fhir/AllergyIntolerance` | `resident.chart.write` |
| `events:read` | `GET /api/v1/events` | `resident.read`, `task.read` |
| `fhir:read` | alle lesenden Ressourcen unter `/api/fhir` | `resident.read` |
| `labs:write` | `POST /api/v1/labs` (Laborbefunde, Schnittstelle vorbereitet) | `admin.integrations` |
| `documents:write` | `POST /api/fhir/DocumentReference` (Austritts- und Klinikberichte in die Akte) | `resident.chart.write` |

### Module

Endpunkte abgeschalteter Module (Admin → Klinische Konfiguration → Module, PRD §69) antworten mit `403 module_inactive`,
z. B. `GET /api/fhir/MedicationStatement` ohne Modul «Medikation».

### Rate Limits und Fehler

- 600 Anfragen pro Minute und Token; 30 fehlgeschlagene Anmeldungen pro Minute und IP. Bei Überschreitung `429` mit `Retry-After`. Die Zähler liegen in Postgres und gelten über alle Instanzen.
- Gehäufte fehlgeschlagene API-Anmeldungen lösen einen Sicherheitsalarm aus (Admin → Sicherheit).
- Fehlerformat REST: `{ "error": { "code": "…", "message": "…" } }`

| Status | code | Bedeutung |
|---|---|---|
| 400 | `bad_request` | ungültiger Parameter |
| 401 | `unauthorized` | Token fehlt, ist ungültig, abgelaufen oder widerrufen |
| 403 | `insufficient_scope` | Token hat den nötigen Scope nicht (`WWW-Authenticate` nennt ihn) |
| 403 | `insufficient_permission` | persönliches Token: der Person fehlen die Berechtigungen für den Scope (nicht mehr organisationsweit) |
| 403 | `module_inactive` | Modul der Organisation abgeschaltet |
| 403 | `org_suspended` | Organisation durch den Plattform-Betrieb gesperrt |
| 404 | `not_found` | Datensatz nicht vorhanden oder nicht in der Organisation |
| 409 | `conflict` | Zustand erlaubt die Änderung nicht (z. B. Aufgabe bereits quittiert) |
| 422 | `validation_failed` | Body ungültig, `message` nennt die Felder |
| 429 | `rate_limited` | zu viele Anfragen |

FHIR-Endpunkte liefern Fehler als `OperationOutcome`.

## REST API v1

### Bewohnende

`GET /api/v1/residents?unitId=&status=&q=&limit=&cursor=`

- `status`: `current` (Standard: aktiv und abwesend), `active`, `absent`, `discharged`, `deceased`, `all`
- `limit`: 1–500 (Standard 100). Paginierung: `next` aus der Antwort als `cursor` übergeben.

```json
{
  "data": [{
    "id": "cmv…", "firstName": "Ruth", "lastName": "Brunner", "birthDate": "1938-03-14", "sex": "f",
    "status": "active", "unitId": "cmv…", "unit": "Wohngruppe 2", "room": "201", "careLevel": 8,
    "rea": "no", "allergies": ["Penicillin"], "admittedAt": "2026-04-03T22:00:00.000Z", "dischargedAt": null
  }],
  "next": "cmv…"
}
```

`GET /api/v1/residents/{id}` – zusätzlich `physician`, `risks`, `diet`, `mobility`, `importantNotes`, `primaryNurseId`, `contacts[]`.

### Patientenadministration (ADT)

Scope `residents:adt`. Jeder Vorgang wird als Pflegeepisode (`CareEpisode`) geführt, im Audit-Protokoll vermerkt und als Event
`resident.updated` verteilt. Akten werden nie gelöscht. Zeitpunkte `at` mit Zeitzone, nicht in der Zukunft (5 Min. Toleranz).

`POST /api/v1/residents` – Eintritt (HL7 ADT A01):

```json
{
  "unitId": "cmv…", "roomId": "cmv…", "firstName": "Ruth", "lastName": "Brunner", "birthDate": "1938-03-14", "sex": "f",
  "insuranceNo": "756.1234.5678.97", "physician": "Dr. med. P. Keller", "allergies": ["Penicillin"], "rea": "no",
  "admittedAt": "2026-10-22T10:00:00+02:00", "reason": "Eintritt"
}
```

Antwort `201` mit der Person. Zimmer ohne freies Bett → `409 room_occupied`; Bereich/Zimmer nicht in der Organisation → `422`.

`POST /api/v1/residents/{id}/adt` – Verlegung (A02), Abwesenheit (A21), Rückkehr (A22), Austritt (A03):

```json
{ "event": "transfer", "unitId": "cmv…", "roomId": "cmv…", "reason": "Wechsel Demenzabteilung" }
{ "event": "leave", "reason": "Spitalaufenthalt", "expectedReturn": "2026-10-30" }
{ "event": "return", "roomId": "cmv…" }
{ "event": "discharge", "deceased": false, "reason": "Austritt nach Hause" }
```

Antwort `200` mit der aktualisierten Person. Offene Aufgaben ziehen bei der Verlegung mit, werden während einer Abwesenheit als «nicht durchgeführt (abwesend)» abgeschlossen und nach dem Austritt entfernt.

### HL7 v2 ADT

`POST /api/v1/hl7` (Scope `residents:adt`) – dieselben Vorgänge als HL7-v2-Nachricht, z. B. direkt aus dem KIS des Spitals.
Body: genau eine Nachricht im ER7-Format (Segmente durch CR oder LF getrennt, höchstens 256 KB), `Content-Type: x-application/hl7-v2+er7`
oder `text/plain`. Ausgeführt wird über dieselbe Logik wie in der Akte (Pflegeepisoden, Aufgabenregeln, Event `resident.updated`).

| Ereignis | Vorgang | Zuordnung |
|---|---|---|
| `A01` | Eintritt | Bereich `PV1-3.1` (Name oder Kurzname), Zimmer `PV1-3.2`, Eintritt `PV1-44` |
| `A02` | Verlegung | neuer Bereich/Zimmer aus `PV1-3` |
| `A03` | Austritt | Zeitpunkt `PV1-45`; verstorben bei `PID-30 = Y` oder `PV1-36 = 20` |
| `A21` | Abwesenheit (Beurlaubung) | – |
| `A22` | Rückkehr | – |

Die Person wird über die AHV-Nummer gefunden (`PID-3` mit Typ `SS` oder Assigning Authority `2.16.756.5.32`, sonst `PID-19`),
ersatzweise über Name (`PID-5`) und Geburtsdatum (`PID-7`). Zeitpunkt des Vorgangs aus `EVN-6`, sonst `EVN-2`.

```
MSH|^~\&|KIS|SPITAL|CAREOS|LINDENHOF|20261023101500||ADT^A01^ADT_A01|MSG00001|P|2.5
EVN|A01|20261023101000
PID|1||7561234567897^^^&2.16.756.5.32&ISO^SS||Muster^Erika||19380314|F
PV1|1|I|WG 1^101
```

Antwort immer HTTP `200` mit einer ACK-Nachricht (`x-application/hl7-v2+er7`); das Ergebnis steht in `MSA-1` und als Code in `MSA-3`:

| `MSA-1` | Bedeutung | Codes (Auswahl) |
|---|---|---|
| `AA` | verarbeitet | `admitted`, `admitted_without_room`, `transferred`, `discharged`, `leave`, `returned`, `duplicate` (gleiche Kontroll-ID `MSH-10` bereits verarbeitet, nichts doppelt ausgeführt) |
| `AE` | inhaltlich abgewiesen | `resident_unknown`, `unit_unknown`, `already_admitted`, `pid_name`, `pid_birth`, `no_pid` sowie die Codes der ADT-Endpunkte (z. B. `room_occupied`) |
| `AR` | nicht verarbeitbar | `unsupported_type` (kein ADT), `unsupported_event`, `no_msh`, `message too large` |

Jede Nachricht wird als Integrationslauf (Admin → Integrationen und API) und im Audit-Protokoll (`api.hl7.adt`, ohne Nachrichteninhalt) festgehalten.

### Aufgaben

`GET /api/v1/tasks?unitId=&date=YYYY-MM-DD&status=&lang=de|fr|it|en`

Liefert die Aufgaben eines Tages (Standard: heute, Zeitzone der Organisation), ohne `unitId` für alle Bereiche. Aufgaben aus Pflegeplanung, Medikation und Assessments werden vorher automatisch erzeugt. `title` ist in der gewünschten Sprache, `titleKey` der gespeicherte Wert.

`status` ist der gespeicherte Zustand (`planned`, `in_progress`, `done`, `partial`, `skipped`, `escalated`). `state` ist der Anzeigezustand wie in der App: zusätzlich `over` (überfällig, ab 15 Min. nach Fälligkeit), `due` (bereit / jetzt fällig, ab 30 Min. vorher) und `up` (geplant).

`POST /api/v1/tasks`

```json
{
  "unitId": "cmv…",
  "residentId": "cmv…",
  "title": "Lagerung prüfen",
  "description": "optional",
  "category": "Pflege",
  "dueAt": "2026-10-22T09:00:00+02:00",
  "durationMin": 10,
  "priority": "routine | important | critical",
  "assigneeId": "optional"
}
```

Antwort `201` mit der Aufgabe. Löst das Event `task.created` aus.

`PATCH /api/v1/tasks/{id}` – Aufgabe quittieren:

```json
{ "status": "done | partial | skipped", "note": "Pflicht bei partial und skipped" }
```

Löst `task.completed` aus. Bereits abgeschlossene Aufgaben → `409`.

### Verlauf und Vitalwerte

`POST /api/v1/observations` – Pflegebericht-Eintrag und/oder Vitalwerte (z. B. aus Medizingeräten). Einträge werden nie überschrieben.

```json
{
  "residentId": "cmv…",
  "category": "observation | care | physician | relatives | incident | handover",
  "text": "Messwerte aus Gerät übernommen.",
  "important": false,
  "at": "2026-10-21T08:15:00+02:00",
  "vitals": { "sys": 142, "dia": 85, "pulse": 76, "temp": 36.8, "spo2": 95, "glucose": 6.1, "weight": 64.2, "respRate": 16, "pain": 2 },
  "vitalsNote": "optional"
}
```

`text` oder mindestens ein Vitalwert ist Pflicht. Werte ausserhalb der Plausibilitätsgrenzen → `422`. Die Antwort enthält bei Vitalwerten `abnormal` (Parameter ausserhalb der Grenzwerte der Organisation bzw. der Person). Events: `observation.created`, `vitals.recorded`, ggf. `vitals.abnormal`.

### Laborbefunde (Schnittstelle vorbereitet)

`POST /api/v1/labs` – Befunde eines Labors übernehmen (PRD §40). Zuordnung über die CareOS-Kennung (`residentId`) oder die Versichertennummer (`insuranceNo`). Befunde mit bereits übernommener `externalId` werden übersprungen; Korrekturen des Labors kommen als neuer Befund. Die Beurteilung (`flag`) wird, falls nicht angegeben, aus dem Referenzbereich abgeleitet.

```json
{
  "results": [
    { "residentId": "cmv…", "externalId": "L-2026-0042", "code": "2951-2", "name": "Natrium", "value": "131", "unit": "mmol/l",
      "refRange": "135-145", "flag": "low", "collectedAt": "2026-10-22T07:30:00+02:00" }
  ]
}
```

Antwort `201`: `{ "data": { "imported": 1, "skipped": 0, "runId": "…" } }`. Jeder Aufruf erscheint unter **Admin → Integrationen → Schnittstellen → Letzte Läufe** (nur Zählwerte) und im Audit-Protokoll (`api.labs.import`). Ist eine Integration der Art «Labor» aktiv, wird der Lauf ihr zugeordnet. Höchstens 500 Befunde pro Aufruf.

### Domain Events (Polling)

`GET /api/v1/events?since=<cursor>&type=task.created,task.completed&limit=`

Events in zeitlicher Reihenfolge, älteste zuerst. Ohne `since` die letzten 24 Stunden. Den Wert `next` beim nächsten Aufruf als `since` übergeben; `hasMore: true` bedeutet, dass sofort weitergelesen werden kann.

```json
{
  "data": [{ "id": "cmv…", "type": "task.completed", "unitId": "cmv…", "residentId": "cmv…", "actorId": "cmv…", "payload": { "taskId": "cmv…" }, "createdAt": "…" }],
  "next": "MjAyNi0xMC0yMVQyMTo0MDowMC4yMDhafGNtdi4uLg",
  "hasMore": false
}
```

Event-Payloads enthalten nur Referenzen (IDs), keine Gesundheitsdaten. Details werden über die REST- oder FHIR-Endpunkte geladen.

## HL7 FHIR R4

Content-Type `application/fhir+json`. Suchergebnisse sind `Bundle` vom Typ `searchset`. Lesen mit Scope `fhir:read`, Schreiben (`POST /api/fhir/Observation`, `POST /api/fhir/AllergyIntolerance`) mit Scope `observations:write`, externe Berichte (`POST /api/fhir/DocumentReference`) mit Scope `documents:write`.

| Ressource | Interaktionen | Suchparameter |
|---|---|---|
| `GET /api/fhir/metadata` | CapabilityStatement (ohne Anmeldung) | – |
| `Patient` | read, search | `_id`, `name`, `family`, `given`, `birthdate`, `gender`, `identifier`, `active`, `_count` |
| `Observation` | read, search, **create** | `patient`/`subject`, `code`, `category=vital-signs`, `date` (`eq`/`ge`/`gt`/`le`/`lt`), `_count` |
| `MedicationStatement` | search (nur mit Modul «Medikation») | `patient`/`subject`, `status` (`active`, `stopped`, `completed`), `_count` |
| `AllergyIntolerance` | search, **create** (ergänzt die Allergien der Person, nie überschreiben; bereits erfasst → `200`) | `patient`, `_count` |
| `DocumentReference` | read, search, **create** (externer Bericht als PDF/Bild in die Akte) | `patient`/`subject`, `_count` |

### Abbildung

- **Patient** ← Bewohner/in: `identifier` (`urn:careos:resident` = CareOS-ID, `urn:careos:insurance-number` = Versichertennummer), `name`, `gender` (`male`/`female`/`other`/`unknown`), `birthDate`, `active` (aktiv/abwesend), `deceasedBoolean`, `managingOrganization`.
- **Observation** ← Vitalmessung. Eine Messung mit mehreren Werten ergibt je Parameter eine Observation mit der ID `<messung>-<parameter>`, Profil *vitalsigns*, Kategorie `vital-signs`, Einheiten nach UCUM:

| Parameter | LOINC | UCUM |
|---|---|---|
| Blutdruck systolisch | 8480-6 | mm[Hg] |
| Blutdruck diastolisch | 8462-4 | mm[Hg] |
| Puls | 8867-4 | /min |
| Temperatur | 8310-5 | Cel |
| SpO₂ | 59408-5 | % |
| Blutzucker | 2339-0 | mmol/L |
| Gewicht | 29463-7 | kg |
| Atemfrequenz | 9279-1 | /min |

- **MedicationStatement** ← Verordnung: Präparat als Text, `status`, `effectivePeriod`, `reasonCode` (Indikation), `informationSource` (verordnende Person), `dosage` je Zeitpunkt bzw. als Reserve (`asNeededBoolean`).
- **AllergyIntolerance** ← Allergie-Einträge der Akte (Freitext in `code.text`, `verificationStatus = unconfirmed`), ID `<bewohner>-<index>`.
- **DocumentReference** ← Datei der Akte (Akte → Dateien): `description` = Titel, `category` = CareOS-Kategorie (`urn:careos:file-category`),
  `date` = Berichtsdatum bzw. Ablagezeitpunkt, `content[0].attachment` nur mit Metadaten (`contentType`, `title`, `size`, `creation`; der
  Inhalt ist in der App abrufbar). Externe Berichte zusätzlich mit LOINC-Typ (`18842-5` Austrittsbericht, `11488-4` Klinikbericht) und den
  Extensions `urn:careos:external-report` (`true`) und `urn:careos:received-via` (`fhir`).

Beispiel:

```
GET /api/fhir/Observation?patient=Patient/cmv…&code=http://loinc.org|8480-6&date=ge2026-10-01
Authorization: Bearer cos_…
```

### Observation schreiben

`POST /api/fhir/Observation` (Scope `observations:write`) – Vitalwert aus Messgeräten oder dem Spital. Einzelwert mit LOINC-Code der
Tabelle oben (zusätzlich Schmerz `72514-3`, Einheit `{score}`) oder Blutdruck-Panel `85354-9` mit den Komponenten 8480-6/8462-4.
Einheiten nach UCUM (z. B. `mm[Hg]`, `/min`, `Cel`, `%`, `mmol/L`, `kg`). Es entsteht immer eine neue Messung (nie überschrieben),
Plausibilitätsgrenzen wie in der App (`422` ausserhalb). Antwort `201` mit der Observation bzw. einem Bundle, Header `Location`;
Events `vitals.recorded` und ggf. `vitals.abnormal`.

```json
{
  "resourceType": "Observation", "status": "final",
  "subject": { "reference": "Patient/cmv…" }, "effectiveDateTime": "2026-10-22T08:15:00+02:00",
  "code": { "coding": [{ "system": "http://loinc.org", "code": "8867-4" }] },
  "valueQuantity": { "value": 76, "unit": "/min", "system": "http://unitsofmeasure.org", "code": "/min" }
}
```

### AllergyIntolerance schreiben

`POST /api/fhir/AllergyIntolerance` (Scope `observations:write`) – Allergie aus einem Umsystem übernehmen, z. B. aus dem
Austrittsbericht des Spitals. Die Allergie wird den Allergien der Person hinzugefügt (nie überschrieben) und wirkt sofort im
Allergie-Abgleich beim Verordnen und in der Medikamentenrunde. Pflichtfelder: `patient.reference` (`Patient/{id}`, Person aktiv
oder abwesend) und `code.text` oder `code.coding[].display` (höchstens 80 Zeichen). `clinicalStatus` nur `active`;
`verificationStatus` `refuted` und `entered-in-error` werden abgewiesen (`422`) – Allergien entfernt die Pflege in der Akte.

```json
{
  "resourceType": "AllergyIntolerance",
  "patient": { "reference": "Patient/cmv…" },
  "clinicalStatus": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", "code": "active" }] },
  "code": { "text": "Penicillin" }
}
```

Antwort `201` mit der AllergyIntolerance und Header `Location`; ist dieselbe Allergie bereits erfasst (ohne Gross-/Kleinschreibung
und Akzente), `200` mit dem bestehenden Eintrag. Gleichzeitige Änderung der Akte → `409 conflict` (erneut senden). Event
`resident.updated`, Audit `api.fhir.allergy.create`.

### DocumentReference schreiben (externe Berichte)

`POST /api/fhir/DocumentReference` (Scope `documents:write`) – Austrittsbericht des Spitals oder Bericht einer externen Klinik. Die
Datei wird wie ein Upload in der Akte unter **Dateien** abgelegt (Kategorie «Bericht», Railway Bucket, Zugriff nur mit Leserecht auf
die Akte), als externer Bericht markiert und mit «eingegangen über Schnittstelle» angezeigt. Die Pflege des Bereichs wird benachrichtigt
(dienstbewusst, wie andere klinische Meldungen).

Pflichtfelder: `status = current`, `subject.reference` (`Patient/{id}`, Person aktiv oder abwesend), `type` (LOINC-Code oder `type.text`;
`18842-5`, `34105-7` und `11490-0` gelten als Austrittsbericht, alle anderen als Klinikbericht), Titel (`content[0].attachment.title`,
sonst `description`, höchstens 200 Zeichen), Datum (`date`, sonst `attachment.creation`; ISO 8601 als Datum oder mit Zeitzone, nicht in
der Zukunft) und genau ein Anhang mit `contentType` `application/pdf`, `image/jpeg`, `image/png`, `image/webp` oder `image/heic` und
dem Inhalt base64-kodiert in `data` (höchstens 12 MB; `url` wird nicht unterstützt). Der Inhalt muss zum Dateityp passen (Dateisignatur).

```json
{
  "resourceType": "DocumentReference", "status": "current",
  "subject": { "reference": "Patient/cmv…" }, "date": "2026-10-22T14:30:00+02:00",
  "type": { "coding": [{ "system": "http://loinc.org", "code": "18842-5", "display": "Discharge summary" }] },
  "content": [{ "attachment": { "contentType": "application/pdf", "title": "Austrittsbericht Kantonsspital", "data": "JVBERi0xLjcK…" } }]
}
```

Antwort `201` mit der DocumentReference und Header `Location`. Fehler: `422` (Prüfung), `404` (Person nicht gefunden oder nicht aktuell),
`413` (Anfrage zu gross), `503 storage_not_configured` (keine Dateiablage eingerichtet). Event `resident.updated`, Audit `api.fhir.document.create`.

## Webhooks

Webhooks werden in **Admin → Integrationen und API → Webhooks** angelegt: Ziel-URL (HTTPS), Ereignisse (oder «Alle»). Das Signatur-Secret wird nur bei der Erstellung bzw. Erneuerung angezeigt. «Test senden» (dort oder im Developer-Portal → Webhooks) stellt ein Ereignis `webhook.test` zu; die letzten Zustellungen mit HTTP-Status sind je Webhook sichtbar.

Jede Zustellung ist ein `POST` mit JSON-Body:

```
Content-Type: application/json
X-CareOS-Event: task.completed
X-CareOS-Signature: sha256=5d41402abc4b2a76b9719d911017c592…

{"event":"task.completed","data":{"id":"cmv…","orgId":"cmv…","type":"task.completed","unitId":"cmv…","residentId":"cmv…","actorId":"cmv…","payload":{"taskId":"cmv…"},"createdAt":"2026-10-21T21:40:00.208Z"}}
```

Antworten Sie mit `2xx` innert 8 Sekunden. Bei Fehlern wird bis zu dreimal mit wachsendem Abstand erneut zugestellt. Die Reihenfolge ist nicht garantiert; `data.id` ist eindeutig und eignet sich zur Deduplizierung. Für lückenlose Verarbeitung zusätzlich `GET /api/v1/events` verwenden.

### Signatur prüfen

Die Signatur ist `HMAC-SHA256(secret, rawBody)` als Hex, mit Präfix `sha256=`. Immer den **unveränderten Roh-Body** verwenden und in konstanter Zeit vergleichen.

Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verify(rawBody, header, secret) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(header ?? '')
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

Python:

```python
import hashlib, hmac

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header or '')
```

### Ereignisse

`task.created`, `task.completed`, `task.reopened`, `task.escalated`, `observation.created`, `observation.corrected`, `vitals.recorded`, `vitals.abnormal`, `vitals.corrected`, `vitals.reviewed`, `medication.administered`, `medication.changed`, `handover.updated`, `handover.acknowledged`, `incident.reported`, `incident.updated`, `careplan.updated`, `assessment.recorded`, `assessment.corrected`, `wound.updated`, `nutrition.recorded`, `resident.updated`, `visit.updated`, `assignment.updated`, `post.published`, `message.created`, `document.published`, `schedule.changed`, `notification.created` (Liste: `EVENT_TYPES` in `src/lib/admin-shared.ts`, auch in `openapi.json` unter `x-webhooks-events`).

## Datenexport

**Admin → Integrationen und API → Datenexport** (Berechtigung `admin.org`) lädt die gesamte Organisation als JSON herunter (`/admin/export`, Format `careos-export` v1): Struktur, Konfiguration, Mitarbeitende ohne Zugangsdaten und alle Daten der Bewohnenden (PRD §36, Datenportabilität). Nicht enthalten sind Passwort-Hashes, MFA-Geheimnisse, Passkeys, Sitzungen, Token-Hashes und Webhook-Secrets. Jeder Export wird im Audit-Protokoll vermerkt. Das Audit-Protokoll selbst ist als CSV unter **Admin → Audit-Protokoll** exportierbar.

**Kennzahlen → Abrechnung** (Modul «Kennzahlen», Berechtigung `insights.view` im Bereich) liefert je Monat eine CSV mit Pflegestufe, Aufenthalts- und Abwesenheitstagen, dokumentierten Pflegeminuten und Leistungen je Kategorie (`/insights/billing?month=YYYY-MM[&unit=]`, Audit `billing.export`). Die Datenauskunft pro Person liegt in der Akte unter **Historie → Datenschutz** (JSON, Audit `resident.export`).

Exporte sind je Person und Stunde begrenzt (Organisation 5, Audit-Protokoll 20, Abrechnung 30, Datenauskunft 60); darüber `429` mit `Retry-After`.

## Betrieb: Health Check und Metriken

| Endpunkt | Schutz | Inhalt |
|---|---|---|
| `GET /api/health` | öffentlich | `status` (`ok` · `degraded` · `error`), Zustand von Datenbank, Bucket (`HeadBucket`, 60 s zwischengespeichert), Hintergrundjobs (`ok` · `stale` · `failing` · `pending` · `disabled`), Echtzeit und Push. `503` nur ohne Datenbank, damit Railway Deploys bei Bucket-Störungen nicht blockiert. Keine Fehlermeldungen oder Kennungen. |
| `GET /api/metrics` | `Authorization: Bearer <METRICS_TOKEN>`; ohne gesetztes `METRICS_TOKEN` abgeschaltet (`404`) | Prometheus-Textformat: Erreichbarkeit, DB-Latenz, Jobs (`careos_job_ok`, `careos_job_last_run_age_seconds`), aktive Sitzungen, offene Sicherheitsalarme, Serverfehler 24 h, Benachrichtigungen, Domain Events, offene Offline-Vorgänge, neue Rückmeldungen sowie Prozesszähler dieser Instanz (`careos_server_errors_total`, `careos_csp_violations_total`, `careos_notifications_total{category,mode}`, `careos_push_sent_total` …). Nur Summen, keine Personendaten. |
| `POST /api/csp-report` | öffentlich, je IP begrenzt | Empfängt CSP-Verstossberichte des Browsers (`report-uri`/`report-to`) und schreibt Richtlinie, blockierte Herkunft und Routenmuster ins Log. |

