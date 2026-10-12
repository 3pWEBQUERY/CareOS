import { Suspense } from "react";
import FileExplorer from "../files/explorer";

export default function SharedStoragePage() {
  // Die Ablage liest ?folder= und ?file= (useSearchParams), das braucht eine Suspense-Grenze.
  return (
    <Suspense fallback={null}>
      <FileExplorer scope="shared" />
    </Suspense>
  );
}
