"use client";

import { BrandIcon } from "./brand-icon";
import { type ModuleIconName } from "./module-icon";

export type HeaderNotification = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  priority: string;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
};

export function notificationStyle(item: HeaderNotification): { icon: ModuleIconName; tone: string } {
  if (["critical", "high"].includes(item.priority)) return { icon: "alert", tone: "critical" };
  if (item.type === "task") return { icon: "tasks", tone: "attention" };
  if (item.type === "medication") return { icon: "med", tone: "attention" };
  return { icon: "bell", tone: "info" };
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function Brand() {
  return (
    <div className="brand" aria-label="CareOS">
      <BrandIcon size={24} />
      <span className="brand-copy">
        <span className="brand-name">CareOS</span>
        <small>Mehr Zeit für Pflege.</small>
      </span>
    </div>
  );
}
