import { Suspense } from "react";
import TimesheetWorkspace from "../components/timesheet-workspace";

export default function RosterTimesheetPage() {
  return (
    <Suspense>
      <TimesheetWorkspace />
    </Suspense>
  );
}
