# CareOS API

CareOS ist API-first (PRD §40/§41). Es gibt drei Schnittstellen:

| Schnittstelle | Basis-URL | Zweck |
|---|---|---|
| REST API v1 | `/api/v1` | Lesen und Schreiben ausgewählter Daten (JSON) |
| HL7 FHIR R4 | `/api/fhir` | Lesender Zugriff auf Gesundheitsdaten im FHIR-Format |
| Webhooks | Ziel-URL des Empfängers | Domain Events in Echtzeit (HTTP POST, signiert) |

Alle Daten sind auf die Organisation des Tokens beschränkt. Zeiten sind ISO 8601 in UTC (`2026-10-21T08:00:00.000Z`), Datumswerte `YYYY-MM-DD`.

## Authentifizierung

API-Tokens werden in **Admin → Integrationen und API → API-Tokens** erstellt (Berechtigung `admin.integrations`).

```
Authorization: Bearer cos_…
```

- Das Token wird **nur einmal** angezeigt. Gespeichert wird ausschliesslich ein SHA-256-Hash; verlorene Tokens können nicht wiederhergestellt, nur widerrufen und neu erstellt werden.
- Ein Token ist an die Person gebunden, die es erstellt hat. Schreibende Aufrufe werden ihr zugeordnet (z. B. `Observation.authorId`) und im Audit-Protokoll mit `context.via = "api"` und der Token-ID vermerkt. Wird die Person deaktiviert, ist das Token ungültig.
- Widerrufene Tokens werden sofort abgewiesen.

### Scopes

| Scope | Erlaubt |
|---|---|
| `residents:read` | `GET /api/v1/residents`, `GET /api/v1/residents/{id}` |
| `tasks:read` | `GET /api/v1/tasks`, `GET /api/v1/tasks/{id}` |
| `tasks:write` | `POST /api/v1/tasks`, `PATCH /api/v1/tasks/{id}` |
| `observations:write` | `POST /api/v1/observations` |
| `events:read` | `GET /api/v1/events` |
| `fhir:read` | alle Ressourcen unter `/api/fhir` |

### Rate Limits und Fehler

- 600 Anfragen pro Minute und Token; 30 fehlgeschlagene Anmeldungen pro Minute und IP. Bei Überschreitung `429` mit `Retry-After`.
- Fehlerformat REST: `{ "error": { "code": "…", "message": "…" } }`

| Status | code | Bedeutung |
|---|---|---|
| 400 | `bad_request` | ungültiger Parameter |
| 401 | `unauthorized` | Token fehlt, ist ungültig oder widerrufen |
| 403 | `insufficient_scope` | Token hat den nötigen Scope nicht (`WWW-Authenticate` nennt ihn) |
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

## HL7 FHIR R4 (lesend)

Content-Type `application/fhir+json`. Suchergebnisse sind `Bundle` vom Typ `searchset`. Scope `fhir:read`.

| Ressource | Interaktionen | Suchparameter |
|---|---|---|
| `GET /api/fhir/metadata` | CapabilityStatement (ohne Anmeldung) | – |
| `Patient` | read, search | `_id`, `name`, `family`, `given`, `birthdate`, `gender`, `identifier`, `active`, `_count` |
| `Observation` | read, search | `patient`/`subject`, `code`, `category=vital-signs`, `date` (`eq`/`ge`/`gt`/`le`/`lt`), `_count` |
| `MedicationStatement` | search | `patient`/`subject`, `status` (`active`, `stopped`, `completed`), `_count` |
| `AllergyIntolerance` | search | `patient`, `_count` |

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

Beispiel:

```
GET /api/fhir/Observation?patient=Patient/cmv…&code=http://loinc.org|8480-6&date=ge2026-10-01
Authorization: Bearer cos_…
```

## Webhooks

Webhooks werden in **Admin → Integrationen und API → Webhooks** angelegt: Ziel-URL (HTTPS), Ereignisse (oder «Alle»). Das Signatur-Secret wird nur bei der Erstellung bzw. Erneuerung angezeigt. «Test senden» stellt ein Ereignis `webhook.test` zu; die letzten Zustellungen mit HTTP-Status sind je Webhook sichtbar.

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

`task.created`, `task.completed`, `task.reopened`, `task.escalated`, `observation.created`, `observation.corrected`, `vitals.recorded`, `vitals.abnormal`, `medication.administered`, `medication.changed`, `handover.updated`, `handover.acknowledged`, `incident.reported`, `incident.updated`, `careplan.updated`, `assessment.recorded`, `wound.updated`, `nutrition.recorded`, `resident.updated`, `post.published`, `message.created`, `document.published`, `schedule.changed`, `notification.created`.

## Datenexport

**Admin → Integrationen und API → Datenexport** (Berechtigung `admin.org`) lädt die gesamte Organisation als JSON herunter (`/admin/export`, Format `careos-export` v1): Struktur, Konfiguration, Mitarbeitende ohne Zugangsdaten und alle Daten der Bewohnenden (PRD §36, Datenportabilität). Nicht enthalten sind Passwort-Hashes, MFA-Geheimnisse, Passkeys, Sitzungen, Token-Hashes und Webhook-Secrets. Jeder Export wird im Audit-Protokoll vermerkt. Das Audit-Protokoll selbst ist als CSV unter **Admin → Audit-Protokoll** exportierbar.
