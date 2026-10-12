import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CareOS · Mein Dienstplan",
  description: "Eigene Dienste, Teamplan, Anträge und Arbeitszeiten in CareOS.",
};

export default function MyRosterLayout({ children }: LayoutProps<"/mein-dienstplan">) {
  return children;
}
