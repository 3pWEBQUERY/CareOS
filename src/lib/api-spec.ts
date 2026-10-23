/**
 * OpenAPI 3.1 der öffentlichen Schnittstellen (PRD §40/§41, §60 Developer Platform): REST API v1 und HL7 FHIR R4.
 * Gepflegt neben den Route Handlern; `src/lib/api-spec.test.ts` prüft, dass jede Route unter src/app/api/v1 und
 * src/app/api/fhir mit allen exportierten HTTP-Methoden hier beschrieben ist (und umgekehrt).
 * Ausgeliefert als GET /api/v1/openapi.json, dargestellt im Developer-Portal (/developer).
 */
import { API_SCOPES, EVENT_TYPES, type ApiScope } from './admin-shared'

type Json = Record<string, unknown>
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete'

export type ApiOperation = {
  path: string
  method: Method
  /** Gruppe in der Referenz */
  tag: 'Residents' | 'Tasks' | 'Observations' | 'Labs' | 'Events' | 'FHIR' | 'Meta'
  summary: string
  scope: ApiScope | null
  params?: { name: string; in: 'query' | 'path'; required?: boolean; description: string; schema?: Json }[]
  body?: Json
  bodyExample?: unknown
  response: { status: number; description: string; schema?: Json; example?: unknown }
  fhir?: boolean
  /** Abweichender Content-Type (z. B. HL7 v2 ER7) */
  contentType?: string
}

const str = { type: 'string' }
const id = { name: 'id', in: 'path' as const, required: true, description: 'CareOS-ID', schema: str }
const dateTime = { type: 'string', format: 'date-time' }
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` })
const list = (n: string) => ({ type: 'object', properties: { data: { type: 'array', items: ref(n) }, next: { type: ['string', 'null'] } } })
const one = (n: string) => ({ type: 'object', properties: { data: ref(n) } })
const fhirBundle = { type: 'object', description: 'FHIR Bundle (searchset)', properties: { resourceType: { const: 'Bundle' }, type: { const: 'searchset' }, total: { type: 'integer' }, entry: { type: 'array' } } }
const fhirResource = (r: string) => ({ type: 'object', description: `FHIR ${r}`, properties: { resourceType: { const: r }, id: str } })
const count = { name: '_count', in: 'query' as const, description: 'Anzahl Treffer je Seite (begrenzt)', schema: { type: 'integer' } }
const patient = { name: 'patient', in: 'query' as const, description: 'Patient/{id} oder ID (auch subject)', schema: str }

export const API_OPERATIONS: ApiOperation[] = [
  // ── REST API v1 ──
  {
    path: '/api/v1/residents', method: 'get', tag: 'Residents', summary: 'Bewohnende auflisten', scope: 'residents:read',
    params: [
      { name: 'unitId', in: 'query', description: 'Bereich', schema: str },
      { name: 'status', in: 'query', description: 'current (Standard), active, absent, discharged, deceased, all', schema: str },
      { name: 'q', in: 'query', description: 'Suche im Namen', schema: str },
      { name: 'limit', in: 'query', description: '1–500, Standard 100', schema: { type: 'integer' } },
      { name: 'cursor', in: 'query', description: 'Wert `next` der vorherigen Seite', schema: str },
    ],
    response: { status: 200, description: 'Liste mit Paginierung', schema: list('Resident') },
  },
  {
    path: '/api/v1/residents', method: 'post', tag: 'Residents', summary: 'Eintritt (ADT A01)', scope: 'residents:adt',
    body: ref('Admission'),
    bodyExample: { unitId: 'cmv…', roomId: 'cmv…', firstName: 'Ruth', lastName: 'Brunner', birthDate: '1938-03-14', sex: 'f', insuranceNo: '756.1234.5678.97', allergies: ['Penicillin'], rea: 'no', admittedAt: '2026-10-22T10:00:00+02:00' },
    response: { status: 201, description: 'Angelegte Person', schema: one('Resident') },
  },
  { path: '/api/v1/residents/{id}', method: 'get', tag: 'Residents', summary: 'Bewohner/in mit Details', scope: 'residents:read', params: [id], response: { status: 200, description: 'Person inkl. Kontakte, Risiken', schema: one('ResidentDetail') } },
  {
    path: '/api/v1/residents/{id}/adt', method: 'post', tag: 'Residents', summary: 'Verlegung, Abwesenheit, Rückkehr, Austritt (ADT A02/A21/A22/A03)', scope: 'residents:adt', params: [id],
    body: ref('AdtEvent'),
    bodyExample: { event: 'leave', reason: 'Spitalaufenthalt', expectedReturn: '2026-10-30', at: '2026-10-22T14:00:00+02:00' },
    response: { status: 200, description: 'Aktualisierte Person', schema: one('Resident') },
  },
  {
    path: '/api/v1/hl7', method: 'post', tag: 'Residents', summary: 'HL7 v2 ADT empfangen (A01, A02, A03, A21, A22), Antwort ACK', scope: 'residents:adt', contentType: 'x-application/hl7-v2+er7',
    body: { type: 'string', description: 'ER7-Nachricht, Segmente durch CR getrennt (auch text/plain)' },
    bodyExample: 'MSH|^~\\&|KIS|SPITAL|CAREOS|HEIM|202610221000||ADT^A01|MSG0001|P|2.5\rPID|1||756.1234.5678.97^^^CH^SS||Brunner^Ruth||19380314|F\rPV1|1|I|WG2^201',
    response: { status: 200, description: 'ACK (MSA-1 AA/AE/AR) als x-application/hl7-v2+er7, auch bei Fehlern' },
  },
  {
    path: '/api/v1/tasks', method: 'get', tag: 'Tasks', summary: 'Aufgaben eines Tages', scope: 'tasks:read',
    params: [
      { name: 'unitId', in: 'query', description: 'Bereich (ohne: alle)', schema: str },
      { name: 'date', in: 'query', description: 'YYYY-MM-DD, Standard heute', schema: { type: 'string', format: 'date' } },
      { name: 'status', in: 'query', description: 'planned, in_progress, done, partial, skipped, escalated', schema: str },
      { name: 'lang', in: 'query', description: 'Sprache von `title`: de, fr, it, en', schema: str },
    ],
    response: { status: 200, description: 'Aufgaben', schema: { type: 'object', properties: { data: { type: 'array', items: ref('Task') } } } },
  },
  {
    path: '/api/v1/tasks', method: 'post', tag: 'Tasks', summary: 'Aufgabe erstellen', scope: 'tasks:write', body: ref('NewTask'),
    bodyExample: { unitId: 'cmv…', residentId: 'cmv…', title: 'Lagerung prüfen', dueAt: '2026-10-22T09:00:00+02:00', durationMin: 10, priority: 'routine' },
    response: { status: 201, description: 'Aufgabe (Event task.created)', schema: one('Task') },
  },
  { path: '/api/v1/tasks/{id}', method: 'get', tag: 'Tasks', summary: 'Aufgabe lesen', scope: 'tasks:read', params: [id, { name: 'lang', in: 'query', description: 'de, fr, it, en', schema: str }], response: { status: 200, description: 'Aufgabe', schema: one('Task') } },
  {
    path: '/api/v1/tasks/{id}', method: 'patch', tag: 'Tasks', summary: 'Aufgabe quittieren', scope: 'tasks:write', params: [id],
    body: { type: 'object', required: ['status'], properties: { status: { enum: ['done', 'partial', 'skipped'] }, note: { type: 'string', description: 'Pflicht bei partial und skipped' } } },
    bodyExample: { status: 'done' },
    response: { status: 200, description: 'Aufgabe (Event task.completed); bereits abgeschlossen → 409', schema: one('Task') },
  },
  {
    path: '/api/v1/observations', method: 'post', tag: 'Observations', summary: 'Verlaufseintrag und/oder Vitalwerte', scope: 'observations:write', body: ref('NewObservation'),
    bodyExample: { residentId: 'cmv…', category: 'observation', text: 'Messwerte aus Gerät übernommen.', vitals: { sys: 142, dia: 85, pulse: 76 } },
    response: { status: 201, description: 'Erfasster Eintrag; `abnormal` nennt auffällige Parameter' },
  },
  {
    path: '/api/v1/labs', method: 'post', tag: 'Labs', summary: 'Laborbefunde übernehmen (max. 500)', scope: 'labs:write',
    body: { type: 'object', required: ['results'], properties: { results: { type: 'array', maxItems: 500, items: ref('LabResult') } } },
    bodyExample: { results: [{ residentId: 'cmv…', externalId: 'L-2026-0042', code: '2951-2', name: 'Natrium', value: '131', unit: 'mmol/l', refRange: '135-145', collectedAt: '2026-10-22T07:30:00+02:00' }] },
    response: { status: 201, description: 'Zählwerte', example: { data: { imported: 1, skipped: 0, runId: '…' } } },
  },
  {
    path: '/api/v1/events', method: 'get', tag: 'Events', summary: 'Domain Events (Polling)', scope: 'events:read',
    params: [
      { name: 'since', in: 'query', description: 'Cursor `next` des letzten Aufrufs (ohne: letzte 24 h)', schema: str },
      { name: 'type', in: 'query', description: 'Kommagetrennte Event-Typen', schema: str },
      { name: 'limit', in: 'query', description: '1–500, Standard 100', schema: { type: 'integer' } },
    ],
    response: { status: 200, description: 'Events, älteste zuerst', schema: { type: 'object', properties: { data: { type: 'array', items: ref('DomainEvent') }, next: str, hasMore: { type: 'boolean' } } } },
  },
  { path: '/api/v1/openapi.json', method: 'get', tag: 'Meta', summary: 'Diese Spezifikation (ohne Anmeldung)', scope: null, response: { status: 200, description: 'OpenAPI 3.1' } },

  // ── HL7 FHIR R4 ──
  { path: '/api/fhir/metadata', method: 'get', tag: 'FHIR', summary: 'CapabilityStatement (ohne Anmeldung)', scope: null, fhir: true, response: { status: 200, description: 'CapabilityStatement', schema: fhirResource('CapabilityStatement') } },
  {
    path: '/api/fhir/Patient', method: 'get', tag: 'FHIR', summary: 'Patient suchen', scope: 'fhir:read', fhir: true,
    params: ['_id', 'name', 'family', 'given', 'birthdate', 'gender', 'identifier', 'active'].map((n) => ({ name: n, in: 'query' as const, description: 'FHIR-Suchparameter', schema: str })).concat([count]),
    response: { status: 200, description: 'Bundle', schema: fhirBundle },
  },
  { path: '/api/fhir/Patient/{id}', method: 'get', tag: 'FHIR', summary: 'Patient lesen', scope: 'fhir:read', fhir: true, params: [id], response: { status: 200, description: 'Patient', schema: fhirResource('Patient') } },
  {
    path: '/api/fhir/Observation', method: 'get', tag: 'FHIR', summary: 'Vitalwerte suchen', scope: 'fhir:read', fhir: true,
    params: [patient, { name: 'code', in: 'query', description: 'LOINC, z. B. http://loinc.org|8480-6', schema: str }, { name: 'category', in: 'query', description: 'vital-signs', schema: str }, { name: 'date', in: 'query', description: 'eq/ge/gt/le/lt + Datum', schema: str }, count],
    response: { status: 200, description: 'Bundle', schema: fhirBundle },
  },
  {
    path: '/api/fhir/Observation', method: 'post', tag: 'FHIR', summary: 'Vitalwert schreiben (Einzelwert LOINC oder Blutdruck-Panel 85354-9)', scope: 'observations:write', fhir: true,
    body: fhirResource('Observation'),
    bodyExample: { resourceType: 'Observation', status: 'final', subject: { reference: 'Patient/cmv…' }, effectiveDateTime: '2026-10-22T08:15:00+02:00', code: { coding: [{ system: 'http://loinc.org', code: '8867-4' }] }, valueQuantity: { value: 76, unit: '/min', system: 'http://unitsofmeasure.org', code: '/min' } },
    response: { status: 201, description: 'Observation oder Bundle; Header Location', schema: fhirResource('Observation') },
  },
  { path: '/api/fhir/Observation/{id}', method: 'get', tag: 'FHIR', summary: 'Observation lesen', scope: 'fhir:read', fhir: true, params: [id], response: { status: 200, description: 'Observation', schema: fhirResource('Observation') } },
  { path: '/api/fhir/MedicationStatement', method: 'get', tag: 'FHIR', summary: 'Medikation suchen (Modul Medikation)', scope: 'fhir:read', fhir: true, params: [patient, { name: 'status', in: 'query', description: 'active, stopped, completed', schema: str }, count], response: { status: 200, description: 'Bundle', schema: fhirBundle } },
  {
    path: '/api/fhir/AllergyIntolerance', method: 'post', tag: 'FHIR', summary: 'Allergie übernehmen (ergänzt, nie überschreiben)', scope: 'observations:write', fhir: true,
    body: fhirResource('AllergyIntolerance'),
    bodyExample: { resourceType: 'AllergyIntolerance', patient: { reference: 'Patient/cmv…' }, code: { text: 'Penicillin' } },
    response: { status: 201, description: 'AllergyIntolerance; bereits erfasst → 200', schema: fhirResource('AllergyIntolerance') },
  },
  { path: '/api/fhir/AllergyIntolerance', method: 'get', tag: 'FHIR', summary: 'Allergien suchen', scope: 'fhir:read', fhir: true, params: [patient, count], response: { status: 200, description: 'Bundle', schema: fhirBundle } },
  {
    path: '/api/fhir/DocumentReference', method: 'post', tag: 'FHIR', summary: 'Externen Bericht übernehmen (Austritts- oder Klinikbericht, PDF/Bild base64)', scope: 'documents:write', fhir: true,
    body: fhirResource('DocumentReference'),
    bodyExample: {
      resourceType: 'DocumentReference', status: 'current', subject: { reference: 'Patient/cmv…' }, date: '2026-10-22T14:30:00+02:00',
      type: { coding: [{ system: 'http://loinc.org', code: '18842-5', display: 'Discharge summary' }] },
      content: [{ attachment: { contentType: 'application/pdf', title: 'Austrittsbericht Kantonsspital', data: 'JVBERi0xLjcK…' } }],
    },
    response: { status: 201, description: 'DocumentReference; Header Location', schema: fhirResource('DocumentReference') },
  },
  { path: '/api/fhir/DocumentReference', method: 'get', tag: 'FHIR', summary: 'Dateien und externe Berichte suchen', scope: 'fhir:read', fhir: true, params: [patient, count], response: { status: 200, description: 'Bundle', schema: fhirBundle } },
  { path: '/api/fhir/DocumentReference/{id}', method: 'get', tag: 'FHIR', summary: 'DocumentReference lesen', scope: 'fhir:read', fhir: true, params: [id], response: { status: 200, description: 'DocumentReference (Metadaten, ohne Inhalt)', schema: fhirResource('DocumentReference') } },
]

const SCHEMAS: Record<string, Json> = {
  Resident: {
    type: 'object',
    properties: {
      id: str, firstName: str, lastName: str, birthDate: { type: 'string', format: 'date' }, sex: { enum: ['f', 'm', 'd', null] },
      status: { enum: ['active', 'absent', 'discharged', 'deceased'] }, unitId: str, unit: str, room: { type: ['string', 'null'] }, careLevel: { type: ['integer', 'null'] },
      rea: { enum: ['yes', 'no', 'unknown'] }, allergies: { type: 'array', items: str }, admittedAt: dateTime, dischargedAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  ResidentDetail: { allOf: [ref('Resident'), { type: 'object', properties: { physician: str, risks: { type: 'array', items: str }, diet: str, mobility: str, importantNotes: str, primaryNurseId: str, contacts: { type: 'array', items: { type: 'object' } } } }] },
  Admission: {
    type: 'object', required: ['unitId', 'firstName', 'lastName', 'birthDate'],
    properties: { unitId: str, roomId: str, firstName: str, lastName: str, birthDate: { type: 'string', format: 'date' }, sex: { enum: ['f', 'm', 'd'] }, insuranceNo: str, physician: str, allergies: { type: 'array', items: str, maxItems: 30 }, rea: { enum: ['yes', 'no', 'unknown'] }, admittedAt: dateTime, reason: str },
  },
  AdtEvent: {
    oneOf: [
      { type: 'object', required: ['event', 'unitId'], properties: { event: { const: 'transfer' }, unitId: str, roomId: str, at: dateTime, reason: str } },
      { type: 'object', required: ['event', 'reason'], properties: { event: { const: 'leave' }, reason: str, expectedReturn: { type: 'string', format: 'date' }, at: dateTime } },
      { type: 'object', required: ['event'], properties: { event: { const: 'return' }, roomId: str, at: dateTime } },
      { type: 'object', required: ['event'], properties: { event: { const: 'discharge' }, deceased: { type: 'boolean' }, reason: str, at: dateTime } },
    ],
  },
  Task: {
    type: 'object',
    properties: {
      id: str, unitId: str, residentId: { type: ['string', 'null'] }, title: str, titleKey: str, description: { type: ['string', 'null'] }, category: str, dueAt: dateTime,
      durationMin: { type: ['integer', 'null'] }, priority: { enum: ['routine', 'important', 'critical'] },
      status: { enum: ['planned', 'in_progress', 'done', 'partial', 'skipped', 'escalated'] }, state: { enum: ['done', 'partial', 'skipped', 'escalated', 'in_progress', 'over', 'due', 'up'] },
    },
  },
  NewTask: { type: 'object', required: ['unitId', 'title', 'dueAt'], properties: { unitId: str, residentId: str, title: str, description: str, category: str, dueAt: dateTime, durationMin: { type: 'integer' }, priority: { enum: ['routine', 'important', 'critical'] }, assigneeId: str } },
  NewObservation: {
    type: 'object', required: ['residentId'],
    properties: {
      residentId: str, category: { enum: ['observation', 'care', 'physician', 'relatives', 'incident', 'handover'] }, text: str, important: { type: 'boolean' }, at: dateTime,
      vitals: { type: 'object', properties: Object.fromEntries(['sys', 'dia', 'pulse', 'temp', 'spo2', 'glucose', 'weight', 'respRate', 'pain'].map((k) => [k, { type: 'number' }])) }, vitalsNote: str,
    },
  },
  LabResult: { type: 'object', required: ['name', 'value', 'collectedAt'], properties: { residentId: str, insuranceNo: str, externalId: str, code: str, name: str, value: str, unit: str, refRange: str, flag: { enum: ['low', 'high', 'normal', 'critical'] }, collectedAt: dateTime } },
  DomainEvent: { type: 'object', properties: { id: str, type: { enum: [...EVENT_TYPES] }, unitId: str, residentId: str, actorId: str, payload: { type: 'object' }, createdAt: dateTime } },
  Error: { type: 'object', properties: { error: { type: 'object', properties: { code: str, message: str } } } },
}

const ERRORS: Json = {
  '400': { description: 'bad_request' },
  '401': { description: 'unauthorized – Token fehlt, ist abgelaufen oder widerrufen', content: { 'application/json': { schema: ref('Error') } } },
  '403': { description: 'insufficient_scope · insufficient_permission (persönliches Token) · module_inactive · org_suspended' },
  '404': { description: 'not_found' },
  '422': { description: 'validation_failed' },
  '429': { description: 'rate_limited (Retry-After)' },
}

/** Stabile operationId, z. B. getV1ResidentsId (auch i18n-Schlüssel im Developer-Portal: developer.ops.<id>). */
export const operationId = (op: Pick<ApiOperation, 'method' | 'path'>) =>
  `${op.method}${op.path.replace(/^\/api/, '').replace(/[{}]/g, '').split(/[/.]/).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join('')}`

/** OpenAPI-Dokument. `server` = Basis-URL der Installation (APP_URL). */
export function openApiDocument(server: string): Json {
  const paths: Record<string, Json> = {}
  for (const op of API_OPERATIONS) {
    const ct = op.contentType ?? (op.fhir ? 'application/fhir+json' : 'application/json')
    paths[op.path] ??= {}
    paths[op.path][op.method] = {
      tags: [op.tag],
      summary: op.summary,
      operationId: operationId(op),
      ...(op.scope ? { security: [{ bearer: [op.scope] }], 'x-scope': op.scope } : { security: [] }),
      ...(op.params?.length ? { parameters: op.params.map((p) => ({ name: p.name, in: p.in, required: p.required ?? p.in === 'path', description: p.description, schema: p.schema ?? str })) } : {}),
      ...(op.body ? { requestBody: { required: true, content: { [ct]: { schema: op.body, ...(op.bodyExample ? { example: op.bodyExample } : {}) } } } } : {}),
      responses: {
        [String(op.response.status)]: { description: op.response.description, ...(op.response.schema || op.response.example ? { content: { [ct]: { ...(op.response.schema ? { schema: op.response.schema } : {}), ...(op.response.example ? { example: op.response.example } : {}) } } } : {}) },
        ...(op.scope ? ERRORS : {}),
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'CareOS API',
      version: '1.0.0',
      description: 'REST API v1 und HL7 FHIR R4. Alle Daten sind auf die Organisation des Tokens beschränkt; Zeiten ISO 8601 (UTC). Webhooks: signiert mit HMAC-SHA256 (Header X-CareOS-Signature).',
    },
    servers: [{ url: server }],
    tags: [...new Set(API_OPERATIONS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'cos_…', description: `Scopes: ${API_SCOPES.join(', ')}` } },
      schemas: SCHEMAS,
    },
    'x-webhooks-events': [...EVENT_TYPES],
  }
}

/** Route-Pfad (src/app/api/…/route.ts) → OpenAPI-Pfad: `[id]` → `{id}`. */
export const routeToPath = (rel: string) => '/api/' + rel.replace(/\/route\.ts$/, '').replace(/\[([^\]]+)\]/g, '{$1}')
