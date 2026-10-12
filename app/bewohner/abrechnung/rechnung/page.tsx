import { Suspense } from "react";
import InvoicePrint from "../../components/invoice-print";

export default function InvoicePrintPage() {
  return (
    <Suspense>
      <InvoicePrint />
    </Suspense>
  );
}
