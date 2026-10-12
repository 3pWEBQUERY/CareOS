import type { Metadata } from "next";
import "./operations.css";

export const metadata: Metadata = {
  title: "CareOS · Betrieb",
  description: "Schicht, Aufgaben, Übergaben und Dienstplanung in CareOS.",
};

export default function OperationsLayout({ children }: LayoutProps<"/betrieb">) {
  return children;
}
