"use client";

import TimesheetWorkspace from "@/app/dienstplan/components/timesheet-workspace";

// Meine Zeiten: dieselbe Auswertung wie für die Leitung, beschränkt auf die eigene Person.
export default function MyTimes() {
  return <TimesheetWorkspace own />;
}
