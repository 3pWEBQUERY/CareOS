import { Suspense } from "react";
import RequestsWorkspace from "../components/requests-workspace";

export default function RosterRequestsPage() {
  return (
    <Suspense>
      <RequestsWorkspace />
    </Suspense>
  );
}
