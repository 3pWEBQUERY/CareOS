"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Sparkle, X } from "@phosphor-icons/react";
import { AssistantView } from "@/app/intelligenz/components/assistant-view";
import { useWorkContext } from "./care-context";

// CareOS KI from every page: a header button opening the assistant as side panel (right, full screen on phones).
export function HeaderAiButton() {
  const router = useRouter();
  const context = useWorkContext();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!context?.profile.permissions.includes("ai.use")) return null;
  return (
    <>
      <button
        className={`icon-button shortcut-trigger ${open ? "open" : ""}`}
        type="button"
        aria-label="CareOS KI öffnen"
        title="CareOS KI"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Sparkle aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            className="ai-drawer-overlay"
            role="presentation"
            onMouseDown={(event) => event.currentTarget === event.target && setOpen(false)}
          >
            <section className="ai-drawer" role="dialog" aria-modal="true" aria-labelledby="ai-panel-title">
              <header className="ai-drawer-head">
                <span className="ai-drawer-mark" aria-hidden="true">
                  <Sparkle weight="fill" />
                </span>
                <div>
                  <p className="eyebrow">CareOS KI</p>
                  <h2 id="ai-panel-title">Assistenz</h2>
                </div>
                <button
                  className="icon-button ai-drawer-close"
                  type="button"
                  aria-label="KI schliessen"
                  onClick={() => setOpen(false)}
                >
                  <X aria-hidden="true" />
                </button>
              </header>
              <AssistantView
                variant="panel"
                onOpenDrafts={() => {
                  setOpen(false);
                  router.push("/c/intelligenz/entwuerfe");
                }}
              />
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
