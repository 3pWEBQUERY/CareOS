import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CareOS · Dienstplan",
  description: "Dienstplanung, Anträge, Arbeitszeit und Einstellungen des Dienstplans in CareOS.",
};

export default function RosterLayout({ children }: LayoutProps<"/dienstplan">) {
  return children;
}
