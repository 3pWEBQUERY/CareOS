import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { listOpenShifts } from "@/lib/roster/open-shift-service";
import { myRequests } from "@/lib/roster/request-service";
import { listSwaps } from "@/lib/roster/swap-service";
import { myCorrections } from "@/lib/roster/time-service";

export const runtime = "nodejs";

export async function GET() {
  return respond(async () => {
    const ctx = await rosterContext();
    const [requests, swaps, corrections, openShifts] = await Promise.all([
      myRequests(ctx),
      listSwaps(ctx, { own: true }),
      myCorrections(ctx),
      listOpenShifts(ctx, { own: true }),
    ]);
    return { ...requests, swaps, corrections, openShifts, userId: ctx.actor.id };
  }, "Deine Anträge konnten nicht geladen werden.");
}
