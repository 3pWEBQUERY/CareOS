import type { Metadata } from "next";
import "./wounds.css";

export const metadata: Metadata = {
  title: "CareOS · Wundübersicht",
  description: "Zentrale Wundübersicht für Versorgung, Verlauf und Dokumentation in CareOS.",
};

export default function WoundManagementLayout({ children }: LayoutProps<"/wundmanagement">) {
  return children;
}
