"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";

// Rechtes Seitenpanel (70 %) wie alle Dialoge in CareOS, für Ansichten ohne Formular.
export function SidePanel({
  id,
  eyebrow,
  title,
  description,
  onClose,
  actions,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="area-editor-overlay"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        className="area-editor-panel editor-dialog roster-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="area-editor-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={`${id}-title`}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="area-editor-close" type="button" aria-label="Fenster schliessen" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="area-editor-form roster-panel-body">{children}</div>
        {actions && (
          <footer className="area-editor-actions appointment-editor-actions roster-panel-actions">{actions}</footer>
        )}
      </section>
    </div>
  );
}
