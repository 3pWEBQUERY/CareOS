import "server-only";
import { invalid } from "./errors";
import type { Body } from "./schemas";

// JSON body of a request; an empty or broken body is an input error, not a server error.
export async function readBody(request: Request): Promise<Body> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Body;
  } catch {
    throw invalid("Die Anfrage ist ungültig.");
  }
}
