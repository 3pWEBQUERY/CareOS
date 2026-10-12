import { StatusPage } from "./components/status-page";

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="Seite nicht gefunden"
      text="Diese Adresse gibt es in CareOS nicht (mehr). Vielleicht wurde der Link falsch kopiert oder die Seite verschoben."
    />
  );
}
