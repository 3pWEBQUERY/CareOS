import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-context";
import { carecoreActor } from "@/lib/server-data";
import { officeLiveStream } from "@/lib/shared-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ fileId: string }> };

// Abstand der Prüfungen und Dauer einer Verbindung; danach verbindet sich der Browser selbst neu (EventSource).
const CHECK_MS = 1_000;
const CONNECTION_MS = 50_000;
const PING_MS = 15_000;

// Gleichzeitiges Bearbeiten: meldet sofort, wenn jemand anderes gespeichert hat (neuer Stand) oder wer gerade
// wo in der Datei ist. Inhalte reisen hier nicht mit; den neuen Stand holt der Editor bei Bedarf selbst.
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
    const { fileId } = await params;
    const state = await officeLiveStream(actor, fileId, new URL(request.url).searchParams.get("session") ?? "");
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (text: string) => controller.enqueue(encoder.encode(text));
        const stop = () => {
          try {
            controller.close();
          } catch {
            // bereits geschlossen
          }
        };
        request.signal.addEventListener("abort", stop);
        send("retry: 2000\n\n");
        const started = Date.now();
        let last = "";
        let pinged = Date.now();
        while (!request.signal.aborted && Date.now() - started < CONNECTION_MS) {
          try {
            const current = JSON.stringify(await state());
            if (current !== last) {
              send(`event: state\ndata: ${current}\n\n`);
              last = current;
              pinged = Date.now();
            } else if (Date.now() - pinged > PING_MS) {
              send(": ping\n\n");
              pinged = Date.now();
            }
          } catch {
            // Datei gelöscht oder nicht mehr erreichbar: Verbindung beenden, der Editor fragt selbst nach.
            send("event: gone\ndata: {}\n\n");
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, CHECK_MS));
        }
        stop();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Verbindung zur Datei fehlgeschlagen.");
  }
}
