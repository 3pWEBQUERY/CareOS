import { redirect } from "next/navigation";

// Dienste plant die Leitung jetzt im Dienstplan; alte Links bleiben gültig.
export default function TeamleadShiftsPage() {
  redirect("/c/dienstplan");
}
