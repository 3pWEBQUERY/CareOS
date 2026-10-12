import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CareOS · Kompass",
  description: "Bedarfsabklärung mit dem CareOS Kompass: Abklärungen, Verantwortlichkeiten und Auswertungen.",
};

export default function RaiLayout({ children }: LayoutProps<"/kompass">) {
  return children;
}
