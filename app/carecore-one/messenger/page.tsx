import { Suspense } from "react";
import ChatWorkspace from "../chat/chat-workspace";

export default function CareOSOneMessengerPage() {
  // Der Messenger liest ?conversation= (useSearchParams), das braucht auf einer statischen Seite eine Suspense-Grenze.
  return (
    <Suspense fallback={null}>
      <ChatWorkspace />
    </Suspense>
  );
}
