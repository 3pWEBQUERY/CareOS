import type { Metadata } from "next";
import "./medication.css";

export const metadata: Metadata = {
  title: "CareOS · Medikation",
  description: "Medikamentenplan, Medikamentenrunde, Bestände und ärztlich verordnete Reserven in CareOS.",
};

export default function MedicationLayout({ children }: LayoutProps<"/medikation">) {
  return children;
}
