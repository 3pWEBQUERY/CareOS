import { observationResource, searchObservations } from "@/lib/fhir";
import { fhirSearch } from "@/lib/fhir-http";

export const runtime = "nodejs";

export function GET(request: Request) {
  return fhirSearch(request, "system/Observation.read", "Observation", searchObservations, observationResource);
}
