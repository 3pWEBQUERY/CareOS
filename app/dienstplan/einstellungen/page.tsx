import { Suspense } from "react";
import SettingsWorkspace from "../components/settings-workspace";

export default function RosterSettingsPage() {
  return (
    <Suspense>
      <SettingsWorkspace />
    </Suspense>
  );
}
