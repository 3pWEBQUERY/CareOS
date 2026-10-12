import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { getSwapCandidates } from "@/lib/roster/swap-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ shiftId: string }> };

export async function GET(_request: Request, { params }: Context) {
  return respond(
    async () => getSwapCandidates(await rosterContext(), (await params).shiftId),
    "Tauschpartner konnten nicht gesucht werden.",
  );
}
