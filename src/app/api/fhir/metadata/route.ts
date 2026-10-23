import { fhirBase, fhirJson } from '@/lib/fhir'

/** CapabilityStatement (FHIR R4). Öffentlich, wie im Standard vorgesehen – enthält keine Daten. */
export async function GET(req: Request) {
  const search = (name: string, type: string, documentation?: string) => ({ name, type, ...(documentation ? { documentation } : {}) })
  return fhirJson({
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: '2026-10-01',
    publisher: 'CareOS',
    kind: 'instance',
    software: { name: 'CareOS', version: '1.0' },
    implementation: { description: 'CareOS FHIR R4 (lesend; Observation Vitalparameter auch schreibend)', url: fhirBase(req) },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json'],
    rest: [
      {
        mode: 'server',
        security: {
          cors: false,
          service: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/restful-security-service', code: 'OAuth', display: 'Bearer token' }], text: 'Authorization: Bearer <CareOS API token with scope fhir:read>' }],
        },
        resource: [
          {
            type: 'Patient', profile: 'http://hl7.org/fhir/StructureDefinition/Patient',
            interaction: [{ code: 'read' }, { code: 'search-type' }],
            searchParam: [search('_id', 'token'), search('name', 'string'), search('family', 'string'), search('given', 'string'), search('birthdate', 'date'), search('gender', 'token'), search('identifier', 'token'), search('active', 'token'), search('_count', 'number')],
          },
          {
            type: 'Observation', profile: 'http://hl7.org/fhir/StructureDefinition/vitalsigns',
            interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create', documentation: 'Scope observations:write. LOINC 8867-4, 8310-5, 59408-5, 2339-0, 29463-7, 9279-1, 72514-3 oder Blutdruck-Panel 85354-9; UCUM-Einheiten.' }],
            searchParam: [search('patient', 'reference'), search('subject', 'reference'), search('code', 'token', 'LOINC: 8480-6, 8462-4, 8867-4, 8310-5, 59408-5, 2339-0, 29463-7, 9279-1, 72514-3'), search('category', 'token', 'vital-signs'), search('date', 'date', 'ge/le/gt/lt prefixes'), search('_count', 'number')],
          },
          {
            type: 'MedicationStatement', interaction: [{ code: 'search-type' }],
            searchParam: [search('patient', 'reference'), search('subject', 'reference'), search('status', 'token'), search('_count', 'number')],
          },
          {
            type: 'AllergyIntolerance', interaction: [{ code: 'search-type' }, { code: 'create', documentation: 'Scope observations:write. Aktive Allergie (code.text); ergänzt die Allergien der Person, bereits erfasste Einträge → 200.' }],
            searchParam: [search('patient', 'reference'), search('_count', 'number')],
          },
        ],
      },
    ],
  })
}
