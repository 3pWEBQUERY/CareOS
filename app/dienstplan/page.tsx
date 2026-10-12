import { Suspense } from "react";
import RosterPlanner from "./components/roster-planner";

export default function RosterPage() {
  return (
    <Suspense>
      <RosterPlanner />
    </Suspense>
  );
}
