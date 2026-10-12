"use client";

import { useEffect, useRef } from "react";

// Escape schliesst den geöffneten Dialog. Der Listener liegt auf document und läuft damit vor
// window-Listenern (z. B. dem Schliessen der Bewohnerakte); das Ereignis gilt danach als behandelt.
export function useEscapeClose(onClose: () => void, active = true) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}
