import type { Metadata } from "next";
import "./assessments.css";

export const metadata: Metadata = {
  title: "CareOS · Einschätzungen",
  description: "Pflegefachliche Einschätzungen und fällige Assessments in CareOS.",
};

export default function AssessmentsLayout({ children }: LayoutProps<"/einschaetzungen">) {
  return children;
}
