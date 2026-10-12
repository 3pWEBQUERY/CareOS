import { Suspense } from "react";
import DataExportPrint from "../components/data-export-print";

export default function DataExportPage() {
  return (
    <Suspense>
      <DataExportPrint />
    </Suspense>
  );
}
