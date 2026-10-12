"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CaretDown } from "@phosphor-icons/react";

// Bausteine der Menüleiste in Dokument, Tabelle und Präsentation (CareOS-Optik, keine Browser-Auswahlfelder).

// Knöpfe nehmen den Fokus nicht weg: die Auswahl im Text oder in der Tabelle bleibt erhalten.
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

export function ToolButton({
  label,
  icon,
  onClick,
  active,
  disabled,
  shortcut,
  text,
  className,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
  text?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`office-tool ${active ? "active" : ""} ${text ? "with-text" : ""} ${className ?? ""}`}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-tip={label}
      data-shortcut={shortcut}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {icon}
      {text && <span>{text}</span>}
    </button>
  );
}

export const ToolSeparator = () => <span className="office-separator" aria-hidden="true" />;

export function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="office-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}

// Aufklappbares Feld an einem Knopf (Menü, Farben, Tabelle einfügen …), schwebt über allem.
export function ToolPopover({
  label,
  trigger,
  children,
  disabled,
  wide,
  className,
  title,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  disabled?: boolean;
  wide?: boolean;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = panel?.width ?? 220;
    const height = panel?.height ?? 200;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight - 8 && rect.top > height + 14 ? rect.top - height - 6 : below;
    setPosition({ top, left });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`office-tool with-caret ${open ? "open" : ""} ${className ?? ""}`}
        aria-label={label}
        data-tip={open ? undefined : (title ?? label)}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
        <CaretDown className="office-caret" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={`office-popover ${wide ? "wide" : ""}`}
            role="dialog"
            aria-label={label}
            style={{ top: position.top, left: position.left }}
            onMouseDown={(event) => {
              // Eingabefelder im Feld dürfen den Fokus erhalten, alles andere lässt die Auswahl stehen.
              if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement))
                event.preventDefault();
            }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
  style?: React.CSSProperties;
};

export function MenuList({ items, close }: { items: (MenuItem | "separator")[]; close: () => void }) {
  return (
    <div className="office-menu" role="menu">
      {items.map((item, index) =>
        item === "separator" ? (
          <span key={`s${index}`} className="office-menu-separator" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitemradio"
            aria-checked={Boolean(item.active)}
            className={`${item.active ? "active" : ""} ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              close();
              item.onSelect();
            }}
          >
            {item.icon}
            <span style={item.style}>{item.label}</span>
            {item.hint && <small>{item.hint}</small>}
          </button>
        ),
      )}
    </div>
  );
}

// Farben wie in Office: Grundfarben in drei Helligkeiten plus „Automatisch“/„Keine“.
export const PALETTE = [
  ["#1c2b2d", "#5b6b6d", "#0f766e", "#1d4ed8", "#7c3aed", "#be185d", "#b42318", "#c2410c", "#a16207", "#15803d"],
  ["#4b5563", "#9ca3af", "#14b8a6", "#3b82f6", "#a78bfa", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e"],
  ["#e5e7eb", "#f3f4f6", "#ccfbf1", "#dbeafe", "#ede9fe", "#fce7f3", "#fee2e2", "#ffedd5", "#fef9c3", "#dcfce7"],
];
const COLOR_NAMES: Record<string, string> = {
  "#1c2b2d": "Schwarzgrün",
  "#5b6b6d": "Grau",
  "#0f766e": "Petrol",
  "#1d4ed8": "Blau",
  "#7c3aed": "Violett",
  "#be185d": "Beere",
  "#b42318": "Rot",
  "#c2410c": "Orange",
  "#a16207": "Senf",
  "#15803d": "Grün",
};
const colorName = (color: string, row: number) =>
  `${COLOR_NAMES[PALETTE[0][PALETTE[row].indexOf(color)]] ?? "Farbe"}${row === 1 ? " hell" : row === 2 ? " sehr hell" : ""}`;

export function ColorPicker({
  label,
  icon,
  current,
  noneLabel,
  onPick,
}: {
  label: string;
  icon: ReactNode;
  current: string | null;
  noneLabel: string;
  onPick: (color: string | null) => void;
}) {
  return (
    <ToolPopover
      label={label}
      trigger={
        <span className="office-color-trigger">
          {icon}
          <i style={{ background: current ?? "transparent" }} />
        </span>
      }
    >
      {(close) => (
        <div className="office-palette">
          <button
            type="button"
            className="office-palette-none"
            onClick={() => {
              onPick(null);
              close();
            }}
          >
            {noneLabel}
          </button>
          {PALETTE.map((row, rowIndex) => (
            <div key={rowIndex} className="office-palette-row">
              {row.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={current?.toLowerCase() === color ? "active" : ""}
                  style={{ background: color }}
                  aria-label={colorName(color, rowIndex)}
                  data-tip={colorName(color, rowIndex)}
                  onClick={() => {
                    onPick(color);
                    close();
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </ToolPopover>
  );
}

// Bild für Dokument oder Folie: auf höchstens 1600 px verkleinern und als PNG/JPEG einbetten (klein genug fürs
// Speichern, von Word und PowerPoint lesbar).
export async function imageToDataUrl(file: File, maxSide = 1600): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type))
    throw new Error("Bitte ein Bild (PNG, JPEG, GIF oder WebP) wählen.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Das Bild ist zu gross (höchstens 15 MB).");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Das Bild lässt sich nicht lesen."));
      element.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Das Bild lässt sich nicht verarbeiten.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Fotos als JPEG (klein), Grafiken mit Transparenz als PNG.
    const png = file.type === "image/png" || file.type === "image/gif";
    return canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Tabellengrösse wählen wie in Word/PowerPoint (Raster mit Vorschau).
export function TablePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState({ rows: 0, cols: 0 });
  return (
    <div className="office-table-picker">
      <div className="office-table-grid" onMouseLeave={() => setHover({ rows: 0, cols: 0 })}>
        {Array.from({ length: 8 }, (_, row) =>
          Array.from({ length: 10 }, (_, col) => (
            <button
              key={`${row}-${col}`}
              type="button"
              aria-label={`${row + 1} Zeilen, ${col + 1} Spalten`}
              className={row < hover.rows && col < hover.cols ? "active" : ""}
              onMouseEnter={() => setHover({ rows: row + 1, cols: col + 1 })}
              onFocus={() => setHover({ rows: row + 1, cols: col + 1 })}
              onClick={() => onPick(row + 1, col + 1)}
            />
          )),
        )}
      </div>
      <p>{hover.rows ? `${hover.rows} × ${hover.cols} Tabelle` : "Grösse wählen"}</p>
    </div>
  );
}
