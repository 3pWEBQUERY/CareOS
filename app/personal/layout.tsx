import type { Metadata } from "next";
import "./personal.css";

export const metadata: Metadata = {
  title: "CareOS · Personal",
  description: "Neuigkeiten, Schulungen und Dokumente in CareOS.",
};

export default function PersonalLayout({ children }: LayoutProps<"/personal">) {
  return children;
}
