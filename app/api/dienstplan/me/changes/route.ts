import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { myChangeToken } from "@/lib/roster/my-schedule";
import { month } from "@/lib/roster/schemas";

export const runtime = "nodejs";

// Polling für „Mein Dienstplan“: nur ein Vergleichswert.
export async function GET(request: Request) {
  return respond(async () => {
    const ctx = await rosterContext();
    const selected = month(new URL(request.url).searchParams.get("monat"));
    return { token: await myChangeToken(ctx, selected.year, selected.month) };
  }, "Änderungen konnten nicht geprüft werden.");
}
