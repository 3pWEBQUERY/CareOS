"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Tooltips in der CareOS-Optik für alle Elemente mit `data-tip` (Text) und optional `data-shortcut`
// (Tastenkürzel). Erscheinen nach kurzem Verweilen mit der Maus oder sofort bei Tastaturfokus.
type Tip = { text: string; shortcut: string; rect: DOMRect };

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const tipFor = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
    const show = (element: HTMLElement, delay: number) => {
      window.clearTimeout(timer);
      current = element;
      timer = window.setTimeout(() => {
        if (current !== element || !element.isConnected || !element.dataset.tip) return;
        setTip({
          text: element.dataset.tip,
          shortcut: element.dataset.shortcut ?? "",
          rect: element.getBoundingClientRect(),
        });
      }, delay);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const element = tipFor(event.target);
      if (element === current) return;
      if (!element) return hide();
      setTip(null);
      show(element, 450);
    };
    const onFocus = (event: FocusEvent) => {
      const element = tipFor(event.target);
      if (element && element.matches(":focus-visible")) show(element, 120);
    };
    const onLeave = (event: PointerEvent) => {
      if (!current) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (!next || !current.contains(next)) hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onLeave);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onLeave);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // Unter dem Element zentriert, am Bildschirmrand gehalten; ohne Platz unten darüber.
  useLayoutEffect(() => {
    const element = bubble.current;
    if (!tip || !element) return;
    const { width, height } = element.getBoundingClientRect();
    const below = tip.rect.bottom + 8 + height < window.innerHeight - 8;
    element.style.top = `${below ? tip.rect.bottom + 8 : tip.rect.top - height - 8}px`;
    element.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, tip.rect.left + tip.rect.width / 2 - width / 2))}px`;
    element.classList.toggle("above", !below);
    element.classList.add("visible");
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={bubble} className="care-tooltip" role="tooltip" style={{ top: -9999, left: -9999 }}>
      <span>{tip.text}</span>
      {tip.shortcut && <kbd>{tip.shortcut}</kbd>}
    </div>,
    document.body,
  );
}
