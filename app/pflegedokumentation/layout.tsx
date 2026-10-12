import type { Metadata } from "next";
import "./documentation.css";

export const metadata: Metadata = {
  title: "CareOS · Pflegedokumentation",
  description: "Schnell- und Verlaufsdokumentation im CareOS Pflegealltag.",
};

export default function DocumentationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
