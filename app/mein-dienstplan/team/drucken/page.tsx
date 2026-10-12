import { Suspense } from "react";
import RosterPrint from "@/app/dienstplan/components/roster-print";

export default function TeamPlanPrintPage() {
  return (
    <Suspense>
      <RosterPrint team />
    </Suspense>
  );
}
