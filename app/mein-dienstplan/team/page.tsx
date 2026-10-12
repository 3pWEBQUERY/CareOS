import { Suspense } from "react";
import TeamPlan from "../components/team-plan";

export default function TeamPlanPage() {
  return (
    <Suspense>
      <TeamPlan />
    </Suspense>
  );
}
