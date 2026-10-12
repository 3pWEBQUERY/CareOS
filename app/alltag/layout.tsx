import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CareOS · Alltag & Aktivierung",
  description: "Angebote der Alltagsgestaltung planen und die Teilnahme je Person festhalten.",
};

export default function ActivitiesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
