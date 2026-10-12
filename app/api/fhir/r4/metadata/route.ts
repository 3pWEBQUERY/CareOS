import { capabilityStatement } from "@/lib/fhir";
import { fhirBase, fhirJson } from "@/lib/fhir-http";

export const runtime = "nodejs";

// CapabilityStatement: beschreibt die Schnittstelle, enthält keine Daten und ist daher ohne Schlüssel lesbar.
export function GET(request: Request) {
  return fhirJson(capabilityStatement(fhirBase(request)));
}
