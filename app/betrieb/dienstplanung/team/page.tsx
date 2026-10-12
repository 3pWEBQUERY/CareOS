import { redirect } from "next/navigation";

// Der Teamplan ist in das neue Modul umgezogen; alte Links bleiben gültig.
export default function TeamSchedulePage() {
  redirect("/c/mein-dienstplan/team");
}
