import { Suspense } from "react";
import KitchenPrint from "../components/kitchen-print";

export default function KitchenListPage() {
  return (
    <Suspense>
      <KitchenPrint />
    </Suspense>
  );
}
