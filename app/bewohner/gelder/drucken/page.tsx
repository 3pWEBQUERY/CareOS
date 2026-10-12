import { Suspense } from "react";
import FundsPrint from "../../components/funds-print";

export default function FundsPrintPage() {
  return (
    <Suspense>
      <FundsPrint />
    </Suspense>
  );
}
