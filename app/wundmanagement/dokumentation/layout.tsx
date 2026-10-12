import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CareOS · Wunddokumentation",
  description: "Zentrale Wunddokumentation für Befund, Versorgung und Heilungsverlauf in CareOS.",
};

export default function WoundDocumentationLayout({ children }: LayoutProps<"/wundmanagement/dokumentation">) {
  return children;
}
