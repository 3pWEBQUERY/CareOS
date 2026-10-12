import type { Metadata } from "next";
import "./planning.css";

export const metadata: Metadata = {
  title: "CareOS · Pflegeplanung",
  description: "Pflegeziele, Ressourcen und Massnahmen im CareOS Pflegeprozess.",
};

export default function PlanningLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
