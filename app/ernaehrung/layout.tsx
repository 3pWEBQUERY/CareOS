import type { Metadata } from "next";
import "./nutrition.css";

export const metadata: Metadata = {
  title: "CareOS · Ernährung",
  description: "Ernährungsplanung und Trinkprotokolle für die stationäre Pflege.",
};

export default function NutritionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
