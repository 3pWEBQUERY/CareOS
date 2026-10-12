"use client";

import { useEffect, useRef } from "react";
import type { LiveChannel } from "@/lib/live-events";

// Eine gemeinsame Echtzeit-Verbindung (Server-Sent Events) je Tab. Sie besteht, solange mindestens ein Bereich
// zuhört; der Browser verbindet sich nach Unterbrüchen selbst neu. Ohne EventSource bleibt es beim Nachladen im Takt.
const listeners = new Map<LiveChannel, Set<() => void>>();
let source: EventSource | null = null;

function connect() {
  if (source || typeof window === "undefined" || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  for (const channel of listeners.keys()) attach(channel);
}

function attach(channel: LiveChannel) {
  source?.addEventListener(channel, () => listeners.get(channel)?.forEach((listener) => listener()));
}

function disconnect() {
  if ([...listeners.values()].some((set) => set.size)) return;
  source?.close();
  source = null;
}

export function useLiveEvent(channel: LiveChannel, handler: () => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = () => latest.current();
    let set = listeners.get(channel);
    if (!set) {
      set = new Set();
      listeners.set(channel, set);
      attach(channel);
    }
    set.add(listener);
    connect();
    return () => {
      listeners.get(channel)?.delete(listener);
      disconnect();
    };
  }, [channel]);
}
