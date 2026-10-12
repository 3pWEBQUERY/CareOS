import { redirect } from "next/navigation";

// The messenger moved to Kommunikation; old links keep working.
export default function TeamMessagesPage() {
  redirect("/c/carecore-one/messenger");
}
