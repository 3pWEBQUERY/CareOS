import { Suspense } from "react";
import InventoryPrint from "../components/inventory-print";

export default function InventoryPage() {
  return (
    <Suspense>
      <InventoryPrint />
    </Suspense>
  );
}
