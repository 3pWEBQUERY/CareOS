import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CareOS · Bewohnerverlauf",
  description: "Bereichsweiter Pflegeverlauf aller Bewohner in CareOS.",
};

export default function ResidentHistoryLayout({ children }: LayoutProps<"/bewohner/verlauf">) {
  return children;
}
