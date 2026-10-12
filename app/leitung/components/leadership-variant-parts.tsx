"use client";

import { useEffect, useRef, useState } from "react";
import { ModuleIcon } from "@/app/components/module-icon";
import type { SettingKey } from "@/lib/settings-shared";
import type { ConfigurationData } from "./configuration-view";
import type { LeadershipView } from "./leadership-data";
import type { OrganizationData } from "./organization-view";

export type Props = {
  view: LeadershipView;
  showToast: (message: string) => void;
  employeeCreatorOpen: boolean;
  onCloseEmployeeCreator: () => void;
  organization: OrganizationData;
  siteCreatorOpen: boolean;
  onCloseSiteCreator: () => void;
  configuration: ConfigurationData;
  settingKey: SettingKey;
  onSelectSetting: (key: SettingKey) => void;
  settingEditorOpen: boolean;
  onCloseSettingEditor: () => void;
};

export function AreaSelect({
  label,
  value,
  options,
  onChange,
  format = (option) => option,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  format?: (option: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const toggleOpen = () =>
    setOpen((current) => {
      if (!current) {
        const rect = rootRef.current?.getBoundingClientRect();
        const menuHeight = Math.min(options.length * 42 + 16, 300);
        setOpenUp(Boolean(rect && window.innerHeight - rect.bottom < menuHeight && rect.top > menuHeight));
      } else setOpenUp(false);
      return !current;
    });

  return (
    <div className="area-custom-select" ref={rootRef}>
      <button
        className="area-select-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={toggleOpen}
      >
        <span>{format(value)}</span>
        <ModuleIcon name="caretDown" className={open ? "open" : ""} />
      </button>
      {open && (
        <div className={`area-select-menu ${openUp ? "up" : ""}`} role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={value === option}
              className={value === option ? "selected" : ""}
              key={option}
              onClick={(event) => {
                // Inside a <label> the click would otherwise re-activate the trigger and reopen the menu.
                event.preventDefault();
                onChange(option);
                setOpen(false);
                setOpenUp(false);
              }}
            >
              {format(option)}
              <ModuleIcon name="check" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
