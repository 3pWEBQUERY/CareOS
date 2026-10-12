import { Suspense } from "react";
import PortalMessagesWorkspace from "./portal-messages-workspace";

export default function PortalMessagesPage() {
  // Liest ?thread= (Link aus der Benachrichtigung); braucht auf einer statischen Seite eine Suspense-Grenze.
  return (
    <Suspense fallback={null}>
      <PortalMessagesWorkspace />
    </Suspense>
  );
}
