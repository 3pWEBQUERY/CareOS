import { NextResponse } from "next/server";
import { apiContext } from "@/lib/api-context";
import { changedChannels, decodeSnapshot, encodeSnapshot, liveSnapshot, type LiveSnapshot } from "@/lib/live-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Abstand der Prüfungen und Dauer einer Verbindung; danach verbindet sich der Browser selbst neu (EventSource).
const CHECK_MS = 10_000;
const CONNECTION_MS = 50_000;

// Server-Sent Events: meldet, welche Bereiche sich geändert haben (ohne Inhalte). Der Stand reist als Event-ID mit,
// damit nach dem Wiederverbinden auch Änderungen dazwischen gemeldet werden.
export async function GET(request: Request) {
  const ctx = await apiContext();
  if (ctx instanceof NextResponse) return ctx;
  const encoder = new TextEncoder();
  let previous: LiveSnapshot | null = decodeSnapshot(request.headers.get("last-event-id"));
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
      send("retry: 3000\n\n");
      const started = Date.now();
      while (!request.signal.aborted && Date.now() - started < CONNECTION_MS) {
        try {
          const snapshot = await liveSnapshot(ctx);
          const changed = changedChannels(previous, snapshot);
          const id = encodeSnapshot(snapshot);
          if (!previous) send(`id: ${id}\nevent: ready\ndata: {}\n\n`);
          for (const channel of changed) send(`id: ${id}\nevent: ${channel}\ndata: {}\n\n`);
          if (previous && !changed.length) send(": ping\n\n");
          previous = snapshot;
        } catch {
          send("event: error\ndata: {}\n\n");
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
}
