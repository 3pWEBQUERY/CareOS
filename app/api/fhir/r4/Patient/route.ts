import { patientResource, searchPatients } from "@/lib/fhir";
import { fhirSearch } from "@/lib/fhir-http";

export const runtime = "nodejs";

export function GET(request: Request) {
  return fhirSearch(request, "system/Patient.read", "Patient", searchPatients, patientResource);
}
