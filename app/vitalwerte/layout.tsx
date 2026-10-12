import type { Metadata } from "next";
import "./vitals.css";

export const metadata: Metadata = {
  title: "CareOS · Vitalwerte",
  description: "Hausweite Übersicht aller aktuellen Vitalwerte und auffälligen Messungen in CareOS.",
};

export default function VitalsLayout({ children }: LayoutProps<"/vitalwerte">) {
  return children;
}
