import { Suspense } from "react";
import RosterPrint from "../components/roster-print";

export default function RosterPrintPage() {
  return (
    <Suspense>
      <RosterPrint />
    </Suspense>
  );
}
