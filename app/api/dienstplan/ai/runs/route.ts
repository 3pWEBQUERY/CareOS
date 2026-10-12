import { after } from "next/server";
import { startRun } from "@/lib/roster/ai";
import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { readBody } from "@/lib/roster/http";

export const runtime = "nodejs";
// Lange KI-Läufe laufen nach der Antwort weiter; der Browser fragt den Status ab.
export const maxDuration = 300;

export async function POST(request: Request) {
  return respond(
    async () => {
      const ctx = await rosterContext();
      const run = await startRun(ctx, await readBody(request));
      after(run.execute);
      return { id: run.id };
    },
    "Der KI-Lauf konnte nicht gestartet werden.",
    202,
  );
}
