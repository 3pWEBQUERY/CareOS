import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CareOS · Pflegeakten",
  description: "Hausweite Pflegeakten mit Pflegeprofilen, Zielen, Maßnahmen und Evaluationen in CareOS.",
};

export default function CareRecordsLayout({ children }: LayoutProps<"/bewohner/pflegeakte">) {
  return children;
}
