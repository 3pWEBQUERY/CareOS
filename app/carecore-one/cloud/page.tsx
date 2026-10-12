import { Suspense } from "react";
import FileExplorer from "../files/explorer";

export default function CareOSCloudPage() {
  return (
    <Suspense fallback={null}>
      <FileExplorer scope="personal" />
    </Suspense>
  );
}
