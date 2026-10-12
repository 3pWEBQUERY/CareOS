import { observationResource, readObservation } from "@/lib/fhir";
import { fhirRead } from "@/lib/fhir-http";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return fhirRead(request, "system/Observation.read", "Observation", id, readObservation, observationResource);
}
