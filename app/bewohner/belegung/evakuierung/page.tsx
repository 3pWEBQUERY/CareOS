import { Suspense } from "react";
import EvacuationPrint from "../../components/evacuation-print";

export default function EvacuationPage() {
  return (
    <Suspense>
      <EvacuationPrint />
    </Suspense>
  );
}
