import type { Metadata } from "next";
import { TermsTitle } from "./terms-title";

export const metadata: Metadata = {
  title: "CareOS · Bewohner",
  description: "Zentrale Akte im CareOS Pflegearbeitsplatz.",
};

export default function ResidentsLayout({ children }: LayoutProps<"/bewohner">) {
  return (
    <>
      <TermsTitle />
      {children}
    </>
  );
}
