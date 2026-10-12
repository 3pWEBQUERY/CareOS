import { Suspense } from "react";
import KompassReportView from "../components/kompass-report";

export default function KompassReportPage() {
  return (
    <Suspense>
      <KompassReportView />
    </Suspense>
  );
}
