"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ModuleIcon } from "@/app/components/module-icon";

export default function SettingsSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value?: string;
  options?: string[];
  onChange?: (value: string) => void;
}) {
  const selected = value ?? options?.[0] ?? "";
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  // Mit der Tastatur markierte Option (-1: keine).
  const [active, setActive] = useState(-1);
  const listId = useId();
  const list = options ?? [];
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  const toggleOpen = () =>
    setOpen((current) => {
      if (!current) {
        const rect = rootRef.current?.getBoundingClientRect();
        const menuHeight = (options?.length ?? 0) * 42 + 20;
        setOpenUp(Boolean(rect && window.innerHeight - rect.bottom < menuHeight && rect.top > menuHeight));
      } else setOpenUp(false);
      setActive(-1);
      return !current;
    });
  const choose = (option: string) => {
    onChange?.(option);
    setOpen(false);
    setOpenUp(false);
    setActive(-1);
  };
  // Pfeiltasten, Pos1/Ende, Enter/Leertaste wählen, Escape und Tab schliessen.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!list.length) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setActive(Math.max(list.indexOf(selected), 0));
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) =>
        current < 0 ? Math.max(list.indexOf(selected), 0) : (current + step + list.length) % list.length,
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : list.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (active >= 0) choose(list[active]);
      else setOpen(false);
    }
  };
  return (
    <div className="settings-custom-select" ref={rootRef}>
      <button
        className="settings-select-trigger"
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={label}
        onClick={toggleOpen}
        onKeyDown={onKeyDown}
      >
        <span>{selected}</span>
        <ModuleIcon name="caretDown" className={open ? "open" : ""} />
      </button>
      {open && (
        <div id={listId} className={`settings-select-menu ${openUp ? "up" : ""}`} role="listbox" aria-label={label}>
          {list.map((option, index) => (
            <button
              className={[selected === option ? "selected" : "", index === active ? "active" : ""]
                .filter(Boolean)
                .join(" ")}
              type="button"
              role="option"
              id={`${listId}-${index}`}
              aria-selected={selected === option}
              key={option}
              onClick={(event) => {
                // Inside a <label> the click would otherwise re-activate the trigger and reopen the menu.
                event.preventDefault();
                choose(option);
              }}
            >
              {option}
              <ModuleIcon name="check" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
