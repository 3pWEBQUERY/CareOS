"use client";

import { useEffect } from "react";

// Tastaturbedienung aller Seitenpanels und Dialoge (role="dialog" mit aria-modal="true"), ohne jeden einzeln
// anzupassen:
// - Beim Öffnen springt der Fokus ins Panel, auf das erste Bedienelement (meist „Schliessen“, damit auf dem
//   Handy keine Tastatur aufspringt).
// - Tab und Umschalt+Tab bleiben im obersten offenen Panel.
// - Beim Schliessen kehrt der Fokus zum auslösenden Element zurück.
// Mit Escape schliessen sich die Panels selbst (useEscapeClose).
const MODAL = '[role="dialog"][aria-modal="true"]';
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const visible = (element: HTMLElement) => element.getClientRects().length > 0;
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
const topDialog = () => [...document.querySelectorAll<HTMLElement>(MODAL)].at(-1) ?? null;

export default function DialogFocus() {
  useEffect(() => {
    const returnTo = new Map<HTMLElement, HTMLElement | null>();
    let current: HTMLElement | null = null;
    let previous: HTMLElement | null = null;

    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target === current) return;
      previous = current;
      current = event.target;
    };

    const sync = () => {
      const open = [...document.querySelectorAll<HTMLElement>(MODAL)];
      for (const dialog of open) {
        if (returnTo.has(dialog)) continue;
        // Mit autoFocus steht der Fokus schon im Panel; zurück geht es dann zum Element davor.
        returnTo.set(dialog, current && dialog.contains(current) ? previous : current);
        if (dialog.contains(document.activeElement)) continue;
        focusables(dialog)[0]?.focus({ preventScroll: true });
      }
      for (const [dialog, target] of returnTo) {
        if (dialog.isConnected) continue;
        returnTo.delete(dialog);
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost && target?.isConnected) target.focus({ preventScroll: true });
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const dialog = topDialog();
      if (!dialog) return;
      const items = focusables(dialog);
      const active = document.activeElement;
      if (!items.length) return event.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      if (!(active instanceof HTMLElement) || !dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-modal"],
    });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  return null;
}
