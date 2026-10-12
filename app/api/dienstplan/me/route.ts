import { rosterContext } from "@/lib/roster/context";
import { respond } from "@/lib/roster/errors";
import { getMySchedule } from "@/lib/roster/my-schedule";
import { month } from "@/lib/roster/schemas";
import { expireStaleSwaps } from "@/lib/roster/swap-service";
import { localDate } from "@/lib/roster/time";
import { checkMissingClockOuts } from "@/lib/roster/time-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return respond(async () => {
    const ctx = await rosterContext();
    await Promise.all([checkMissingClockOuts(ctx), expireStaleSwaps(ctx)]);
    const value = new URL(request.url).searchParams.get("monat") ?? localDate(new Date(), "Europe/Zurich").slice(0, 7);
    return getMySchedule(ctx, month(value));
  }, "Dein Dienstplan konnte nicht geladen werden.");
}
