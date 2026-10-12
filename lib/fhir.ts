import { iso, type Row, type Sql } from "@/lib/api-context";
import type { ApiClient } from "@/lib/api-keys";

// Öffentliche Schnittstelle nach HL7 FHIR R4, nur lesend: Patient (Personen der Einrichtung) und Observation
// (Vitalwerte). Codes nach LOINC, Einheiten nach UCUM, Einstufung nach HL7 v3 ObservationInterpretation.
// Freitext (Bemerkungen, Notizen) und Fotos werden bewusst nicht ausgegeben.

export const FHIR_VERSION = "4.0.1";
export const FHIR_CONTENT_TYPE = "application/fhir+json; charset=utf-8";
const LOINC = "http://loinc.org";
const UCUM = "http://unitsofmeasure.org";
const CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const INTERPRETATION_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";
export const IDENTIFIER_SYSTEM = "urn:carecore:resident-number";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNT_DEFAULT = 50;
const COUNT_MAX = 200;

export class FhirError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "invalid",
  ) {
    super(message);
  }
}

export const operationOutcome = (message: string, code = "invalid") => ({
  resourceType: "OperationOutcome",
  issue: [{ severity: "error", code, diagnostics: message }],
});

type Coding = { system: string; code: string; display: string };
type ObservationCode = { category: "vital-signs" | "laboratory"; coding: Coding[]; components?: [Coding, Coding] };

// Messwerte von CareOS → LOINC.
export const OBSERVATION_CODES: Record<string, ObservationCode> = {
  Blutdruck: {
    category: "vital-signs",
    coding: [{ system: LOINC, code: "85354-9", display: "Blood pressure panel with all children optional" }],
    components: [
      { system: LOINC, code: "8480-6", display: "Systolic blood pressure" },
      { system: LOINC, code: "8462-4", display: "Diastolic blood pressure" },
    ],
  },
  Puls: { category: "vital-signs", coding: [{ system: LOINC, code: "8867-4", display: "Heart rate" }] },
  Temperatur: { category: "vital-signs", coding: [{ system: LOINC, code: "8310-5", display: "Body temperature" }] },
  Sauerstoffsättigung: {
    category: "vital-signs",
    coding: [
      { system: LOINC, code: "2708-6", display: "Oxygen saturation in Arterial blood" },
      { system: LOINC, code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry" },
    ],
  },
  Blutzucker: {
    category: "laboratory",
    coding: [{ system: LOINC, code: "14743-9", display: "Glucose [Moles/volume] in Capillary blood by Glucometer" }],
  },
  Gewicht: { category: "vital-signs", coding: [{ system: LOINC, code: "29463-7", display: "Body weight" }] },
};

const UCUM_UNITS: Record<string, string> = {
  mmHg: "mm[Hg]",
  "/min": "/min",
  "°C": "Cel",
  "%": "%",
  "mmol/l": "mmol/L",
  kg: "kg",
};

const INTERPRETATION: Record<string, Coding> = {
  normal: { system: INTERPRETATION_SYSTEM, code: "N", display: "Normal" },
  attention: { system: INTERPRETATION_SYSTEM, code: "A", display: "Abnormal" },
  critical: { system: INTERPRETATION_SYSTEM, code: "AA", display: "Critical abnormal" },
};

const GENDER: Record<string, string> = { male: "male", female: "female", diverse: "other" };
const date = (value: unknown) => (iso(value) ?? "").slice(0, 10) || undefined;

export function patientResource(row: Row) {
  const status = String(row.status);
  return {
    resourceType: "Patient",
    id: String(row.id),
    meta: { lastUpdated: iso(row.updated_at) },
    ...(row.external_number ? { identifier: [{ system: IDENTIFIER_SYSTEM, value: String(row.external_number) }] } : {}),
    active: status === "active" || status === "planned",
    name: [
      { use: "official", family: String(row.last_name), given: [String(row.first_name)] },
      ...(row.preferred_name ? [{ use: "nickname", text: String(row.preferred_name) }] : []),
    ],
    gender: GENDER[String(row.gender)] ?? "unknown",
    ...(row.date_of_birth ? { birthDate: date(row.date_of_birth) } : {}),
    ...(status === "deceased"
      ? row.deceased_on
        ? { deceasedDateTime: date(row.deceased_on) }
        : { deceasedBoolean: true }
      : {}),
    ...(row.language
      ? { communication: [{ language: { coding: [{ system: "urn:ietf:bcp:47", code: String(row.language) }] } }] }
      : {}),
  };
}

const quantity = (value: unknown, unit: string) => ({
  value: Number(value),
  unit,
  ...(UCUM_UNITS[unit] ? { system: UCUM, code: UCUM_UNITS[unit] } : {}),
});

export function observationResource(row: Row) {
  const metric = String(row.metric);
  const unit = String(row.unit);
  const code = OBSERVATION_CODES[metric];
  const category = code?.category ?? "vital-signs";
  const interpretation = INTERPRETATION[String(row.status)];
  return {
    resourceType: "Observation",
    id: String(row.id),
    meta: { lastUpdated: iso(row.created_at) },
    status: "final",
    category: [
      {
        coding: [
          {
            system: CATEGORY_SYSTEM,
            code: category,
            display: category === "vital-signs" ? "Vital Signs" : "Laboratory",
          },
        ],
      },
    ],
    code: { ...(code ? { coding: code.coding } : {}), text: metric },
    subject: { reference: `Patient/${row.resident_id}` },
    effectiveDateTime: iso(row.measured_at),
    issued: iso(row.created_at),
    ...(code?.components
      ? {
          component: [
            { code: { coding: [code.components[0]] }, valueQuantity: quantity(row.value, unit) },
            ...(row.secondary_value === null || row.secondary_value === undefined
              ? []
              : [{ code: { coding: [code.components[1]] }, valueQuantity: quantity(row.secondary_value, unit) }]),
          ],
        }
      : { valueQuantity: quantity(row.value, unit) }),
    ...(interpretation ? { interpretation: [{ coding: [interpretation] }] } : {}),
  };
}

// ---------- Suchparameter ----------

function assertKnown(params: URLSearchParams, known: string[]) {
  for (const key of new Set(params.keys()))
    if (!known.includes(key))
      throw new FhirError(`Suchparameter „${key}“ wird nicht unterstützt.`, 400, "not-supported");
}

function paging(params: URLSearchParams) {
  const count = params.get("_count");
  const offset = params.get("_offset");
  const n = count === null ? COUNT_DEFAULT : Number(count);
  const o = offset === null ? 0 : Number(offset);
  if (!Number.isInteger(n) || n < 0 || n > COUNT_MAX)
    throw new FhirError(`_count muss eine ganze Zahl von 0 bis ${COUNT_MAX} sein.`);
  if (!Number.isInteger(o) || o < 0) throw new FhirError("_offset muss eine ganze Zahl ab 0 sein.");
  return { count: n, offset: o };
}

// `ge2026-01-01`, `lt2026-02-01T08:00:00+01:00` … → Grenzen (inklusive/exklusive) als Zeitpunkte.
export function dateBounds(values: string[]) {
  let lower: { at: string; inclusive: boolean } | null = null;
  let upper: { at: string; inclusive: boolean } | null = null;
  for (const raw of values) {
    const match = /^(ge|gt|le|lt)(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(
      raw,
    );
    if (!match) throw new FhirError(`date „${raw}“: erwartet z. B. ge2026-01-01 oder lt2026-01-01T08:00:00Z.`);
    const [, prefix, day, time] = match;
    const start = new Date(time ? `${day}${time}` : `${day}T00:00:00Z`);
    if (Number.isNaN(start.getTime())) throw new FhirError(`date „${raw}“ ist kein gültiges Datum.`);
    // Ein Tag ohne Uhrzeit umfasst den ganzen Tag (UTC).
    const end = time ? start : new Date(start.getTime() + 86_400_000);
    if (prefix === "ge") lower = tighter(lower, { at: start.toISOString(), inclusive: true }, 1);
    if (prefix === "gt") lower = tighter(lower, { at: end.toISOString(), inclusive: !time }, 1);
    if (prefix === "lt") upper = tighter(upper, { at: start.toISOString(), inclusive: false }, -1);
    if (prefix === "le") upper = tighter(upper, { at: end.toISOString(), inclusive: !!time }, -1);
  }
  return { lower, upper };
}

function tighter<T extends { at: string; inclusive: boolean }>(current: T | null, next: T, direction: 1 | -1) {
  if (!current) return next;
  const diff = (Date.parse(next.at) - Date.parse(current.at)) * direction;
  if (diff > 0) return next;
  if (diff < 0) return current;
  return next.inclusive ? current : next;
}

function residentReference(value: string) {
  const id = value.replace(/^Patient\//, "");
  if (!UUID.test(id)) throw new FhirError(`patient „${value}“: erwartet Patient/<id>.`);
  return id;
}

// `code=8867-4`, `code=http://loinc.org|8867-4,29463-7` → Messwerte von CareOS.
function metricsForCodes(value: string) {
  const metrics = new Set<string>();
  for (const token of value.split(",")) {
    const [system, code] = token.includes("|") ? token.split("|", 2) : [null, token];
    for (const [metric, entry] of Object.entries(OBSERVATION_CODES))
      if (entry.coding.some((coding) => coding.code === code && (system === null || system === "" || system === LOINC)))
        metrics.add(metric);
  }
  return [...metrics];
}

// ---------- Abfragen ----------

type Bundle = { total: number; entries: Row[]; count: number; offset: number };

export function searchBundle(
  base: string,
  type: string,
  params: URLSearchParams,
  result: Bundle,
  map: (row: Row) => unknown,
) {
  const link = (offset: number) => {
    const next = new URLSearchParams(params);
    next.set("_count", String(result.count));
    next.set("_offset", String(offset));
    return `${base}/${type}?${next.toString()}`;
  };
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: result.total,
    link: [
      { relation: "self", url: link(result.offset) },
      ...(result.offset + result.count < result.total
        ? [{ relation: "next", url: link(result.offset + result.count) }]
        : []),
      ...(result.offset > 0 ? [{ relation: "previous", url: link(Math.max(0, result.offset - result.count)) }] : []),
    ],
    entry: result.entries.map((row) => ({
      fullUrl: `${base}/${type}/${row.id}`,
      resource: map(row),
      search: { mode: "match" },
    })),
  };
}

const PATIENT_COLUMNS = `id, external_number, first_name, last_name, preferred_name, date_of_birth, gender, language, status, deceased_on, updated_at`;

export async function readPatient(sql: Sql, client: ApiClient, id: string) {
  if (!UUID.test(id)) throw new FhirError("Patient nicht gefunden.", 404, "not-found");
  const rows = (await sql.query(
    `SELECT ${PATIENT_COLUMNS} FROM carecore_residents WHERE id = $1 AND organization_id = $2`,
    [id, client.organizationId],
  )) as Row[];
  if (!rows[0]) throw new FhirError("Patient nicht gefunden.", 404, "not-found");
  return rows[0];
}

export async function searchPatients(sql: Sql, client: ApiClient, params: URLSearchParams): Promise<Bundle> {
  assertKnown(params, ["_id", "identifier", "active", "_count", "_offset"]);
  const { count, offset } = paging(params);
  const id = params.get("_id");
  if (id !== null && !UUID.test(id)) return { total: 0, entries: [], count, offset };
  const identifier = params.get("identifier");
  let number: string | null = null;
  if (identifier !== null) {
    const [system, value] = identifier.includes("|") ? identifier.split("|", 2) : [null, identifier];
    if (system !== null && system !== "" && system !== IDENTIFIER_SYSTEM)
      return { total: 0, entries: [], count, offset };
    number = value;
  }
  const activeParam = params.get("active");
  if (activeParam !== null && activeParam !== "true" && activeParam !== "false")
    throw new FhirError("active muss true oder false sein.");
  const active = activeParam === null ? null : activeParam === "true";
  const where = `organization_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid) AND ($3::text IS NULL OR external_number = $3)
    AND ($4::boolean IS NULL OR (status IN ('active', 'planned')) = $4)`;
  const values = [client.organizationId, id, number, active];
  const [total, rows] = await Promise.all([
    sql.query(`SELECT COUNT(*)::int AS n FROM carecore_residents WHERE ${where}`, values) as Promise<Row[]>,
    sql.query(
      `SELECT ${PATIENT_COLUMNS} FROM carecore_residents WHERE ${where} ORDER BY last_name, first_name, id LIMIT $5 OFFSET $6`,
      [...values, count, offset],
    ) as Promise<Row[]>,
  ]);
  return { total: Number(total[0]?.n ?? 0), entries: rows, count, offset };
}

const OBSERVATION_COLUMNS = `m.id, m.resident_id, m.measured_at, m.metric, m.value, m.unit, m.secondary_value, m.status, m.created_at`;

export async function readObservation(sql: Sql, client: ApiClient, id: string) {
  if (!UUID.test(id)) throw new FhirError("Observation nicht gefunden.", 404, "not-found");
  const rows = (await sql.query(
    `SELECT ${OBSERVATION_COLUMNS} FROM carecore_vital_measurements m
     JOIN carecore_residents r ON r.id = m.resident_id WHERE m.id = $1 AND r.organization_id = $2`,
    [id, client.organizationId],
  )) as Row[];
  if (!rows[0]) throw new FhirError("Observation nicht gefunden.", 404, "not-found");
  return rows[0];
}

export async function searchObservations(sql: Sql, client: ApiClient, params: URLSearchParams): Promise<Bundle> {
  assertKnown(params, ["patient", "subject", "code", "category", "date", "_count", "_offset"]);
  const { count, offset } = paging(params);
  const reference = params.get("patient") ?? params.get("subject");
  const residentId = reference === null ? null : residentReference(reference);
  let metrics: string[] | null = null;
  const code = params.get("code");
  if (code !== null) metrics = metricsForCodes(code);
  const category = params.get("category");
  if (category !== null) {
    const codes = category.split(",").map((token) => token.split("|").pop());
    const inCategory = Object.entries(OBSERVATION_CODES)
      .filter(([, entry]) => codes.includes(entry.category))
      .map(([metric]) => metric);
    metrics = metrics === null ? inCategory : metrics.filter((metric) => inCategory.includes(metric));
  }
  if (metrics !== null && !metrics.length) return { total: 0, entries: [], count, offset };
  const { lower, upper } = dateBounds(params.getAll("date"));
  const where = `r.organization_id = $1 AND ($2::uuid IS NULL OR m.resident_id = $2::uuid)
    AND ($3::text[] IS NULL OR m.metric = ANY($3::text[]))
    AND ($4::timestamptz IS NULL OR m.measured_at > $4 OR ($5 AND m.measured_at = $4))
    AND ($6::timestamptz IS NULL OR m.measured_at < $6 OR ($7 AND m.measured_at = $6))`;
  const values = [
    client.organizationId,
    residentId,
    metrics,
    lower?.at ?? null,
    lower?.inclusive ?? false,
    upper?.at ?? null,
    upper?.inclusive ?? false,
  ];
  const from = `FROM carecore_vital_measurements m JOIN carecore_residents r ON r.id = m.resident_id WHERE ${where}`;
  const [total, rows] = await Promise.all([
    sql.query(`SELECT COUNT(*)::int AS n ${from}`, values) as Promise<Row[]>,
    sql.query(`SELECT ${OBSERVATION_COLUMNS} ${from} ORDER BY m.measured_at DESC, m.id LIMIT $8 OFFSET $9`, [
      ...values,
      count,
      offset,
    ]) as Promise<Row[]>,
  ]);
  return { total: Number(total[0]?.n ?? 0), entries: rows, count, offset };
}

export function capabilityStatement(base: string) {
  const search = (names: Array<[string, string]>) => names.map(([name, type]) => ({ name, type }));
  const paging: Array<[string, string]> = [
    ["_count", "number"],
    ["_offset", "number"],
  ];
  return {
    resourceType: "CapabilityStatement",
    status: "active",
    date: "2026-09-29",
    kind: "instance",
    software: { name: "CareOS" },
    implementation: { description: "CareOS FHIR-Schnittstelle (nur lesend)", url: base },
    fhirVersion: FHIR_VERSION,
    format: ["json"],
    rest: [
      {
        mode: "server",
        security: {
          description:
            "Schlüssel der Einrichtung als Authorization: Bearer cck_…; erstellt und widerrufen in Leitung › Konfiguration.",
        },
        resource: [
          {
            type: "Patient",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: search([["_id", "token"], ["identifier", "token"], ["active", "token"], ...paging]),
          },
          {
            type: "Observation",
            interaction: [{ code: "read" }, { code: "search-type" }],
            searchParam: search([
              ["patient", "reference"],
              ["subject", "reference"],
              ["code", "token"],
              ["category", "token"],
              ["date", "date"],
              ...paging,
            ]),
          },
        ],
      },
    ],
  };
}
