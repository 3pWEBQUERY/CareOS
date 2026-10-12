"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Hinweis beim Darüberfahren (z. B. an Symbolknöpfen in Tabellen), per Portal über allem anderen.
export function SidebarTooltip({
  label,
  shortcut,
  placement = "right",
}: {
  label: string;
  // Tastaturkürzel, als Taste dargestellt (wie unter „Tastaturkürzel“ in der Kopfzeile).
  shortcut?: string;
  placement?: "right" | "top";
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const anchor = anchorRef.current;
    const trigger = anchor?.parentElement;
    if (!trigger) return;
    const updatePosition = () => {
      const rect = trigger.getBoundingClientRect();
      setPosition(
        placement === "top"
          ? { top: rect.top - 8, left: rect.left + rect.width / 2 }
          : { top: rect.top + rect.height / 2, left: rect.right + 12 },
      );
    };
    const show = () => {
      updatePosition();
      setOpen(true);
    };
    const hide = () => setOpen(false);
    trigger.addEventListener("mouseenter", show);
    trigger.addEventListener("mouseleave", hide);
    trigger.addEventListener("focus", show);
    trigger.addEventListener("blur", hide);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      trigger.removeEventListener("mouseenter", show);
      trigger.removeEventListener("mouseleave", hide);
      trigger.removeEventListener("focus", show);
      trigger.removeEventListener("blur", hide);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [placement]);

  return (
    <>
      <span ref={anchorRef} className="sidebar-tooltip-anchor" aria-hidden="true" />
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            className={`sidebar-tooltip sidebar-tooltip-portal ${placement === "top" ? "sidebar-tooltip-top" : ""}`}
            role="tooltip"
            style={{ top: position.top, left: position.left }}
          >
            {label}
            {shortcut && (
              <kbd className="sidebar-tooltip-key" aria-label={`Taste ${shortcut}`}>
                {shortcut}
              </kbd>
            )}
          </span>,
          document.body,
        )}
    </>
  );
}
