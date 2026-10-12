import { redirect } from "next/navigation";

// Der Dienstplan ist in das neue Modul umgezogen; alte Links bleiben gültig.
export default function MySchedulePage() {
  redirect("/c/mein-dienstplan");
}
