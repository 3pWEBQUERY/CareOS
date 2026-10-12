import { redirect } from "next/navigation";

// The calendar moved to Kommunikation; old links keep working.
export default function ShiftCalendarPage() {
  redirect("/c/carecore-one/kalender");
}
