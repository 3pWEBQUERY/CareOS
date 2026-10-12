import { Suspense } from "react";
import TransferSheetPage from "../components/transfer-sheet";

export default function TransferPage() {
  return (
    <Suspense>
      <TransferSheetPage />
    </Suspense>
  );
}
